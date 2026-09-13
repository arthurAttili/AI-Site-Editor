import test from "node:test";
import assert from "node:assert/strict";
import { callProvider, testProvider, listModels } from "../lib/ai-call.js";
import { ProviderError } from "../lib/providers/index.js";

const prompt = { system: "S", user: "U", schema: { type: "object" } };

function claudeSettings(overrides) {
  return {
    provider: "claude",
    providers: { claude: { apiKey: "k", model: "claude-opus-5" }, ...overrides },
  };
}

function openaiSettings() {
  return {
    provider: "openai",
    providers: { openai: { apiKey: "k", model: "gpt-x" } },
  };
}

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("callProvider: claude caminho feliz retorna ops e model", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return jsonRes(200, {
      model: "claude-opus-5-20260101",
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"summary":"feito","ops":[]}' }],
    });
  };
  const result = await callProvider(claudeSettings(), prompt, { fetch: fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(result.summary, "feito");
  assert.deepEqual(result.ops, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.provider, "claude");
  assert.equal(result.model, "claude-opus-5-20260101");
  assert.equal(typeof result.ms, "number");
});

test("callProvider: openai cai de json_schema para json_object e depois none em 400", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ responseFormat: body.response_format });
    if (calls.length < 3) {
      return jsonRes(400, { error: { message: "response_format não suportado" } });
    }
    return jsonRes(200, { model: "gpt-x", choices: [{ message: { content: '{"summary":"ok","ops":[]}' } }] });
  };
  const result = await callProvider(openaiSettings(), prompt, { fetch: fetchImpl });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].responseFormat.type, "json_schema");
  assert.equal(calls[1].responseFormat.type, "json_object");
  assert.equal(calls[2].responseFormat, undefined);
  assert.equal(result.model, "gpt-x");
  assert.equal(result.summary, "ok");
});

test("callProvider: 401 mapeia para kind auth", async () => {
  const fetchImpl = async () => jsonRes(401, { type: "error", error: { message: "chave inválida" } });
  await assert.rejects(
    () => callProvider(claudeSettings(), prompt, { fetch: fetchImpl }),
    (err) => err instanceof ProviderError && err.kind === "auth"
  );
});

test("callProvider: fetch rejeitando mapeia para kind network", async () => {
  const fetchImpl = async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  };
  await assert.rejects(
    () => callProvider(claudeSettings(), prompt, { fetch: fetchImpl }),
    (err) => err instanceof ProviderError && err.kind === "network" && err.message === "Sem conexão com o provedor"
  );
});

test("callProvider: sem chave retorna kind no-key sem chamar fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return jsonRes(200, {});
  };
  const settings = { provider: "claude", providers: { claude: { apiKey: "", model: "claude-opus-5" } } };
  await assert.rejects(
    () => callProvider(settings, prompt, { fetch: fetchImpl }),
    (err) => err instanceof ProviderError && err.kind === "no-key"
  );
  assert.equal(calls, 0);
});

test("testProvider: sucesso devolve ok e model, erro devolve ok:false com kind", async () => {
  const okFetch = async () =>
    jsonRes(200, { model: "m", stop_reason: "end_turn", content: [{ type: "text", text: '{"summary":"ok","ops":[]}' }] });
  const ok = await testProvider(claudeSettings(), { fetch: okFetch });
  assert.equal(ok.ok, true);
  assert.equal(ok.model, "m");

  const settings = { provider: "claude", providers: { claude: { apiKey: "", model: "x" } } };
  const bad = await testProvider(settings, { fetch: okFetch });
  assert.equal(bad.ok, false);
  assert.equal(bad.kind, "no-key");
});

test("listModels: só openai/compat; outros lançam erro em pt-BR", async () => {
  await assert.rejects(
    () => listModels(claudeSettings(), { fetch: async () => jsonRes(200, {}) }),
    (err) => err instanceof ProviderError && err.kind === "http" && /OpenAI/.test(err.message)
  );

  const fetchImpl = async () => jsonRes(200, { data: [{ id: "b" }, { id: "a" }] });
  const models = await listModels(openaiSettings(), { fetch: fetchImpl });
  assert.deepEqual(models, ["a", "b"]);
});
