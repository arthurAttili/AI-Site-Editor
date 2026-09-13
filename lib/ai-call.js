// lib/ai-call.js — orquestra a chamada a um provedor de IA: resolve config,
// monta a requisição do adaptador, faz o `fetch` (injetado), trata erros
// HTTP/rede/timeout e valida a resposta como operações de DOM.
// Módulo ES puro: `fetch` entra por injeção (nunca referencia o global) e o
// módulo nunca toca `chrome` — quem faz a ponte com o service worker é
// background.js (Task 9).

import { getProvider, getProviderConfig, ProviderError } from "./providers/index.js";
import { parseOpsText } from "./providers/json.js";
import { OPS_SCHEMA } from "./prompt.js";

const DEFAULT_TIMEOUT_MS = 180000;
const TEST_PROMPT = {
  system: "Você é um teste de conectividade com a API. Responda apenas o JSON pedido.",
  user: 'Responda com {"summary":"ok","ops":[]}',
  schema: OPS_SCHEMA,
};

function isOpenAiFamily(providerId) {
  return providerId === "openai" || providerId === "compat";
}

async function readJsonSafely(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// `fetch` com timeout via AbortController. Falha de rede (fetch rejeita) e
// timeout (abort) viram ambos ProviderError kind:"network" — só a mensagem
// distingue os dois casos.
async function doFetch(fetchImpl, url, { method = "GET", headers, body } = {}, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ProviderError("Tempo esgotado ao esperar o provedor (timeout).", { kind: "network" });
    }
    throw new ProviderError("Sem conexão com o provedor", { kind: "network" });
  } finally {
    clearTimeout(timer);
  }
}

// Uma tentativa de requisição de chat: monta com `provider.buildRequest`, faz
// o fetch, mapeia erro HTTP (`!res.ok`) e interpreta a resposta com
// `provider.parseResponse`. `opts` carrega `{jsonMode}` para openai/compat.
async function requestOnce(provider, cfg, prompt, opts, fetchImpl, timeoutMs) {
  const { url, headers, body } = provider.buildRequest(cfg, prompt, opts);
  const res = await doFetch(fetchImpl, url, { method: "POST", headers, body }, timeoutMs);
  if (!res.ok) {
    const json = await readJsonSafely(res);
    throw provider.mapHttpError(res.status, json, cfg);
  }
  const json = await readJsonSafely(res);
  return provider.parseResponse(json);
}

// Para openai/compat, tenta nesta ordem `jsonMode`: "schema" → "object" →
// "none", avançando só quando o erro é ProviderError kind:"http" com
// status 400 (resposta rejeitou o modo de JSON pedido) e ainda há um próximo
// modo a tentar. Qualquer outro erro (auth, rate, network, ...) interrompe
// a cadeia imediatamente. Outros provedores fazem uma única tentativa.
async function runPrompt(provider, cfg, prompt, providerId, fetchImpl, timeoutMs) {
  if (!isOpenAiFamily(providerId)) {
    return requestOnce(provider, cfg, prompt, {}, fetchImpl, timeoutMs);
  }
  const modes = ["schema", "object", "none"];
  for (let i = 0; i < modes.length; i++) {
    try {
      return await requestOnce(provider, cfg, prompt, { jsonMode: modes[i] }, fetchImpl, timeoutMs);
    } catch (err) {
      const isLast = i === modes.length - 1;
      const canFallback = err instanceof ProviderError && err.kind === "http" && err.status === 400;
      if (isLast || !canFallback) throw err;
    }
  }
}

// Executa o pedido de edição completo: resolve config/provedor, chama a API
// (com fallback de jsonMode para openai/compat) e valida o texto retornado
// como `{summary, ops, errors}`. Lança ProviderError em qualquer falha
// (no-key, auth, rate, server, http, network, format, refusal).
export async function callProvider(settings, prompt, { fetch: fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const start = Date.now();
  const cfg = getProviderConfig(settings);
  const provider = getProvider(settings.provider);
  const { text, model } = await runPrompt(provider, cfg, prompt, settings.provider, fetchImpl, timeoutMs);
  const { summary, ops, errors } = parseOpsText(text);
  const ms = Date.now() - start;
  return { summary, ops, errors, provider: settings.provider, model: model || cfg.model, ms };
}

// Pedido mínimo de conectividade (usado pela tela de opções para "testar"
// um provedor antes de salvar). Nunca lança — sempre resolve com
// `{ok, model?, error?, kind?}`.
export async function testProvider(settings, { fetch: fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const cfg = getProviderConfig(settings);
    const provider = getProvider(settings.provider);
    const { model } = await runPrompt(provider, cfg, TEST_PROMPT, settings.provider, fetchImpl, timeoutMs);
    return { ok: true, model: model || cfg.model };
  } catch (err) {
    if (err instanceof ProviderError) {
      return { ok: false, error: err.message, kind: err.kind };
    }
    return { ok: false, error: err.message, kind: "http" };
  }
}

// Lista os modelos disponíveis — só openai/compat expõem `GET /models`.
export async function listModels(settings, { fetch: fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!isOpenAiFamily(settings.provider)) {
    throw new ProviderError("listagem de modelos disponível só para OpenAI/compatíveis", { kind: "http" });
  }
  // Sem exigir modelo: listar modelos é o passo que vem ANTES de escolher um.
  const cfg = getProviderConfig(settings, { requireModel: false });
  const provider = getProvider(settings.provider);
  const { url, headers } = provider.buildModelsRequest(cfg);
  const res = await doFetch(fetchImpl, url, { method: "GET", headers }, timeoutMs);
  if (!res.ok) {
    const json = await readJsonSafely(res);
    throw provider.mapHttpError(res.status, json, cfg);
  }
  const json = await readJsonSafely(res);
  return provider.parseModels(json);
}
