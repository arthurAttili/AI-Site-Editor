// lib/providers/openai.js — adaptador puro para a API de Chat Completions da OpenAI
// e para qualquer serviço compatível (OpenRouter, Groq, DeepSeek, Ollama, LM Studio, ...).
// Só monta requisição e interpreta resposta; quem faz o `fetch` é o service worker (Task 9).

import { ProviderError, httpErrorToProviderError } from "./json.js";

export const LABEL = "OpenAI";

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function buildResponseFormat(schema, jsonMode) {
  if (jsonMode === "object") return { type: "json_object" };
  if (jsonMode === "none") return undefined;
  // default: "schema"
  return { type: "json_schema", json_schema: { name: "ops", strict: true, schema } };
}

export function buildRequest(cfg, { system, user, schema }, opts = {}) {
  const jsonMode = opts.jsonMode || "schema";
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/chat/completions`;
  const headers = { "content-type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const body = {
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
  };
  const responseFormat = buildResponseFormat(schema, jsonMode);
  if (responseFormat) body.response_format = responseFormat;
  return { url, headers, body };
}

export function buildModelsRequest(cfg) {
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/models`;
  const headers = {};
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  return { url, headers };
}

export function parseModels(json) {
  const data = Array.isArray(json && json.data) ? json.data : [];
  return data
    .filter(Boolean)
    .map((item) => item.id)
    .filter(Boolean)
    .sort();
}

export function parseResponse(json) {
  const choices = json && Array.isArray(json.choices) ? json.choices : null;
  if (!choices || choices.length === 0) {
    throw new ProviderError("A resposta da API não contém 'choices'.", { kind: "format" });
  }
  const choice = choices[0];
  const message = choice.message || {};
  if (message.refusal || choice.finish_reason === "content_filter") {
    throw new ProviderError(message.refusal || "O modelo recusou-se a responder.", { kind: "refusal" });
  }
  const text = typeof message.content === "string" ? message.content : "";
  return { text, model: json && json.model };
}

export function mapHttpError(status, json, cfg) {
  const label = (cfg && cfg.label) || LABEL;
  return httpErrorToProviderError(status, json, label);
}
