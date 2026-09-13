import test from "node:test";
import assert from "node:assert/strict";
import { extractJSON, parseOpsText } from "../lib/providers/json.js";
import * as claude from "../lib/providers/claude.js";
import * as gemini from "../lib/providers/gemini.js";
import * as openai from "../lib/providers/openai.js";
import { getProvider, COMPAT_PRESETS, getProviderConfig, ProviderError } from "../lib/providers/index.js";
import { OPS_SCHEMA } from "../lib/prompt.js";

const prompt = { system: "S", user: "U", schema: OPS_SCHEMA };

test("extractJSON tolera cercas e lixo", () => {
  assert.deepEqual(extractJSON("claro:\n```json\n{\"a\":1}\n```"), { a: 1 });
  assert.throws(() => extractJSON("nada aqui"), (e) => e instanceof ProviderError && e.kind === "format");
});
test("parseOpsText valida", () => {
  const r = parseOpsText('{"summary":"ok","ops":[{"op":"setText","selector":"p","name":"","value":"x","position":""}]}');
  assert.equal(r.ops.length, 1);
});
test("claude monta requisição conforme spec", () => {
  const { url, headers, body } = claude.buildRequest({ apiKey: "k", model: "claude-opus-5" }, prompt);
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(headers["x-api-key"], "k");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(body.model, "claude-opus-5");
  assert.equal(body.max_tokens, 16000);
  assert.equal(body.fallbacks, "default");
  assert.equal(body.system, "S");
  assert.deepEqual(body.messages, [{ role: "user", content: "U" }]);
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.output_config.format.schema, OPS_SCHEMA);
});
test("claude parse e refusal", () => {
  assert.deepEqual(claude.parseResponse({ model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] }), { text: "{}", model: "m" });
  assert.throws(() => claude.parseResponse({ stop_reason: "refusal", stop_details: { explanation: "x" }, content: [] }), (e) => e.kind === "refusal");
});
test("claude parse sem texto vira erro de formato", () => {
  assert.throws(() => claude.parseResponse({}), (e) => e instanceof ProviderError && e.kind === "format");
  assert.throws(() => claude.parseResponse({ content: [] }), (e) => e instanceof ProviderError && e.kind === "format");
});
test("gemini monta requisição", () => {
  const { url, body } = gemini.buildRequest({ apiKey: "k", model: "gemini-3.7-flash" }, prompt);
  assert.ok(url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=k"));
  assert.equal(body.systemInstruction.parts[0].text, "S");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.ok(body.generationConfig.responseSchema);
  assert.equal(gemini.parseResponse({ candidates: [{ content: { parts: [{ text: "{}" }] } }], modelVersion: "g" }).text, "{}");
  assert.throws(() => gemini.parseResponse({ promptFeedback: { blockReason: "SAFETY" } }), (e) => e.kind === "refusal");
});
test("gemini sem texto e sem bloqueio vira erro de formato", () => {
  assert.throws(() => gemini.parseResponse({}), (e) => e instanceof ProviderError && e.kind === "format");
  assert.throws(() => gemini.parseResponse({ candidates: [] }), (e) => e instanceof ProviderError && e.kind === "format");
  // bloqueio continua sendo "refusal", não "format"
  assert.throws(() => gemini.parseResponse({ promptFeedback: { blockReason: "SAFETY" } }), (e) => e.kind === "refusal");
});
test("openai monta requisição com json_schema e fallback", () => {
  const cfg = { apiKey: "k", model: "gpt-x", baseUrl: "https://api.openai.com/v1" };
  const a = openai.buildRequest(cfg, prompt, { jsonMode: "schema" });
  assert.equal(a.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(a.headers.Authorization, "Bearer k");
  assert.equal(a.body.response_format.type, "json_schema");
  assert.equal(a.body.response_format.json_schema.strict, true);
  assert.equal(a.body.messages[0].role, "system");
  assert.equal(openai.buildRequest(cfg, prompt, { jsonMode: "object" }).body.response_format.type, "json_object");
  assert.equal(openai.buildRequest(cfg, prompt, { jsonMode: "none" }).body.response_format, undefined);
  const b = openai.buildRequest({ apiKey: "", model: "llama", baseUrl: "http://localhost:11434/v1/" }, prompt);
  assert.equal(b.url, "http://localhost:11434/v1/chat/completions");
  assert.equal(b.headers.Authorization, undefined);
  assert.equal(openai.parseResponse({ model: "m", choices: [{ message: { content: "{}" } }] }).text, "{}");
  assert.throws(() => openai.parseResponse({ choices: [{ message: { refusal: "não" } }] }), (e) => e.kind === "refusal");
  assert.deepEqual(openai.parseModels({ data: [{ id: "b" }, { id: "a" }] }), ["a", "b"]);
});
test("openai sem choices vira erro de formato", () => {
  assert.throws(() => openai.parseResponse({}), (e) => e instanceof ProviderError && e.kind === "format");
  assert.throws(() => openai.parseResponse({ choices: [] }), (e) => e instanceof ProviderError && e.kind === "format");
  assert.throws(() => openai.parseResponse({ choices: [null] }), (e) => e instanceof ProviderError && e.kind === "format");
});
test("mapHttpError classifica", () => {
  assert.equal(claude.mapHttpError(401, {}).kind, "auth");
  assert.equal(openai.mapHttpError(429, {}).kind, "rate");
  assert.equal(gemini.mapHttpError(503, {}).kind, "server");
  assert.equal(openai.mapHttpError(400, { error: { message: "response_format not supported" } }).kind, "http");
});
test("openai mapHttpError aceita label configurável (usado por compat)", () => {
  const err = openai.mapHttpError(401, {}, { label: "Groq" });
  assert.equal(err.kind, "auth");
  assert.ok(err.message.startsWith("Groq"));
});
test("index resolve provedor e config", () => {
  assert.equal(getProvider("compat"), openai);
  assert.ok(COMPAT_PRESETS.find(p => p.id === "ollama" && p.needsKey === false));
  const settings = { provider: "compat", providers: { compat: { baseUrl: "https://api.groq.com/openai/v1", apiKey: "g", model: "llama-3.3" } } };
  assert.deepEqual(getProviderConfig(settings), { apiKey: "g", model: "llama-3.3", baseUrl: "https://api.groq.com/openai/v1", label: "Compatível com OpenAI" });
  assert.equal(getProviderConfig({ provider: "openai", providers: { openai: { apiKey: "o", model: "gpt" } } }).baseUrl, "https://api.openai.com/v1");
});
test("index compat lê providers.compat.presetId (com fallback silencioso para preset)", () => {
  const bySettings = { provider: "compat", providers: { compat: { presetId: "groq", apiKey: "g" } } };
  const cfg = getProviderConfig(bySettings);
  assert.equal(cfg.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(cfg.model, "llama-3.3-70b-versatile");
  assert.equal(cfg.label, "Groq");

  const legacySettings = { provider: "compat", providers: { compat: { preset: "groq", apiKey: "g" } } };
  const legacyCfg = getProviderConfig(legacySettings);
  assert.equal(legacyCfg.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(legacyCfg.label, "Groq");
});
