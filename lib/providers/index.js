// lib/providers/index.js — registro dos provedores, presets "compatível com OpenAI"
// e resolução de configuração a partir de `settings`. Módulo ES puro.

import { ProviderError } from "./json.js";
import * as claude from "./claude.js";
import * as gemini from "./gemini.js";
import * as openai from "./openai.js";

export { ProviderError };

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const PROVIDERS = {
  claude: { label: "Claude (Anthropic)" },
  gemini: { label: "Gemini (Google)" },
  openai: { label: "OpenAI" },
  compat: { label: "Compatível com OpenAI" },
};

const MODULES = {
  claude,
  gemini,
  openai,
  compat: openai,
};

export const COMPAT_PRESETS = [
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-5", needsKey: true },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", needsKey: true },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", needsKey: true },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", needsKey: true },
  { id: "xai", label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", model: "grok-4", needsKey: true },
  { id: "together", label: "Together AI", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", needsKey: true },
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "llama3.1", needsKey: false },
  { id: "lmstudio", label: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", model: "local-model", needsKey: false },
];

export function getProvider(id) {
  return MODULES[id];
}

function getCompatConfig(settings) {
  const cfg = (settings.providers && settings.providers.compat) || {};
  // `presetId` é o campo definido pelo shape de settings da Task 7; `preset`
  // fica como fallback silencioso para robustez.
  const presetId = cfg.presetId || cfg.preset;
  const preset = COMPAT_PRESETS.find((p) => p.id === presetId);
  const needsKey = preset ? preset.needsKey !== false : true;
  const apiKey = cfg.apiKey || "";
  const baseUrl = cfg.baseUrl || (preset && preset.baseUrl) || "";
  const model = cfg.model || (preset && preset.model) || "";
  const label = (preset && preset.label) || PROVIDERS.compat.label;
  if (needsKey && !apiKey) {
    throw new ProviderError("Informe a chave de API do provedor compatível com OpenAI.", { kind: "no-key" });
  }
  return { apiKey, model, baseUrl, label };
}

// Resolve `{apiKey, model, baseUrl}` a partir do objeto `settings` (Task 7 define
// seu shape completo). Lança ProviderError kind:"no-key" quando falta uma chave
// exigida pelo provedor/preset escolhido.
export function getProviderConfig(settings) {
  const providerId = settings.provider;

  if (providerId === "compat") {
    return getCompatConfig(settings);
  }

  const cfg = (settings.providers && settings.providers[providerId]) || {};
  const label = PROVIDERS[providerId] ? PROVIDERS[providerId].label : providerId;
  if (!cfg.apiKey) {
    throw new ProviderError(`Informe a chave de API do provedor ${label}.`, { kind: "no-key" });
  }
  const baseUrl = providerId === "openai" ? OPENAI_BASE_URL : undefined;
  return { apiKey: cfg.apiKey, model: cfg.model, baseUrl };
}
