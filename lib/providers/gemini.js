// lib/providers/gemini.js — adaptador puro para a API generateContent do Gemini.
// Só monta requisição e interpreta resposta; quem faz o `fetch` é o service worker (Task 9).

import { ProviderError, httpErrorToProviderError } from "./json.js";

export const LABEL = "Gemini (Google)";

// Gemini rejeita "additionalProperties" no responseSchema — remove a chave
// recursivamente (arrays e objetos aninhados) sem mutar o schema original.
export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) {
    return schema.map((item) => toGeminiSchema(item));
  }
  if (schema && typeof schema === "object") {
    const out = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === "additionalProperties") continue;
      out[key] = toGeminiSchema(value);
    }
    return out;
  }
  return schema;
}

export function buildRequest(cfg, { system, user, schema }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
  const headers = { "content-type": "application/json" };
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(schema),
    },
  };
  return { url, headers, body };
}

function isBlocked(json) {
  if (json && json.promptFeedback && json.promptFeedback.blockReason) return true;
  const candidate = json && Array.isArray(json.candidates) ? json.candidates[0] : null;
  if (candidate && candidate.finishReason === "SAFETY") return true;
  return false;
}

export function parseResponse(json) {
  if (isBlocked(json)) {
    const reason =
      (json.promptFeedback && json.promptFeedback.blockReason) ||
      (json.candidates && json.candidates[0] && json.candidates[0].finishReason);
    throw new ProviderError(`O modelo recusou-se a responder (${reason}).`, { kind: "refusal" });
  }
  const candidate = json && Array.isArray(json.candidates) ? json.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts
    .filter((part) => part && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  if (!text) {
    throw new ProviderError("O modelo não retornou conteúdo.", { kind: "format" });
  }
  return { text, model: json && json.modelVersion ? json.modelVersion : undefined };
}

export function mapHttpError(status, json) {
  const body = json && json.error ? json : { error: json };
  return httpErrorToProviderError(status, body, LABEL);
}
