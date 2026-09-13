// lib/providers/claude.js — adaptador puro para a API de Mensagens da Anthropic.
// Só monta requisição e interpreta resposta; quem faz o `fetch` é o service worker (Task 9).

import { ProviderError, httpErrorToProviderError } from "./json.js";

export const LABEL = "Claude (Anthropic)";

const URL_MESSAGES = "https://api.anthropic.com/v1/messages";

export function buildRequest(cfg, { system, user, schema }) {
  const url = URL_MESSAGES;
  const headers = {
    "x-api-key": cfg.apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
    "anthropic-beta": "server-side-fallback-2026-07-01",
    "content-type": "application/json",
  };
  const body = {
    model: cfg.model,
    max_tokens: 16000,
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema } },
  };
  return { url, headers, body };
}

export function parseResponse(json) {
  if (json && json.stop_reason === "refusal") {
    const explanation = json.stop_details && json.stop_details.explanation;
    throw new ProviderError(explanation || "O modelo recusou-se a responder.", { kind: "refusal" });
  }
  const content = Array.isArray(json && json.content) ? json.content : [];
  const text = content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  if (!text) {
    throw new ProviderError("A resposta da API não contém texto.", { kind: "format" });
  }
  return { text, model: json && json.model };
}

export function mapHttpError(status, json) {
  if (json && json.type === "error" && json.error) {
    return httpErrorToProviderError(status, { error: json.error }, LABEL);
  }
  return httpErrorToProviderError(status, json, LABEL);
}
