// lib/providers/json.js — erros de provedor, extração de JSON de texto livre e
// validação do resultado de "ops". Módulo ES puro: nada de `fetch`/`document`/`chrome`.

import { validateOps } from "../ops.js";

export class ProviderError extends Error {
  constructor(message, { status, kind } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.kind = kind;
  }
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

// Tenta, nesta ordem: (1) o texto inteiro, (2) o conteúdo da primeira cerca
// ```json / ```, (3) a substring do primeiro "{" ao último "}". Qualquer falha
// nas três tentativas vira ProviderError kind:"format".
export function extractJSON(text) {
  const raw = typeof text === "string" ? text.trim() : "";

  const attempts = [() => raw];

  const fenceMatch = FENCE_RE.exec(raw);
  if (fenceMatch) {
    attempts.push(() => fenceMatch[1].trim());
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    attempts.push(() => raw.slice(first, last + 1));
  }

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt());
    } catch {
      // tenta a próxima estratégia
    }
  }

  throw new ProviderError("Não foi possível interpretar a resposta do modelo como JSON.", { kind: "format" });
}

// Extrai o JSON do texto do modelo e valida as operações com `validateOps`.
export function parseOpsText(text) {
  const parsed = extractJSON(text);
  const { ops, errors } = validateOps(parsed);
  return { summary: typeof parsed.summary === "string" ? parsed.summary : "", ops, errors };
}

function messageFromBody(json) {
  if (json && json.error && typeof json.error.message === "string") return json.error.message;
  if (json && typeof json.message === "string") return json.message;
  return null;
}

// Classificação comum de erro HTTP compartilhada pelos provedores. O `message`
// resultante é uma frase curta em pt-BR prefixada com o rótulo do provedor e
// nunca inclui a chave de API.
export function httpErrorToProviderError(status, json, providerLabel) {
  const label = providerLabel ? `${providerLabel}: ` : "";
  if (status === 401 || status === 403) {
    return new ProviderError(`${label}chave inválida ou sem permissão.`, { status, kind: "auth" });
  }
  if (status === 429) {
    return new ProviderError(`${label}limite de requisições excedido, tente novamente em instantes.`, { status, kind: "rate" });
  }
  if (status >= 500) {
    return new ProviderError(`${label}o serviço está indisponível no momento.`, { status, kind: "server" });
  }
  const bodyMessage = messageFromBody(json);
  return new ProviderError(`${label}${bodyMessage || `erro ao chamar a API (status ${status}).`}`, { status, kind: "http" });
}
