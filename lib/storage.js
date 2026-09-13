// lib/storage.js — settings e presets por origin sobre `chrome.storage.local`.
// Módulo ES puro: `storage` entra por injeção ({get(keys)→Promise<obj>, set(obj)→Promise}),
// nada de `chrome`/`document`/`window` globais. `crypto.randomUUID()` é global do runtime.

export const DEFAULT_SETTINGS = {
  provider: "claude",
  language: "pt-BR",
  indicatorPosition: "bottom",
  providers: {
    claude: { apiKey: "", model: "claude-opus-5" },
    gemini: { apiKey: "", model: "gemini-3.7-flash" },
    openai: { apiKey: "", model: "" },
    compat: { presetId: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "", model: "" },
  },
};

const SETTINGS_KEY = "settings";
const presetsKey = (origin) => `presets:${origin}`;

// Chaves que nunca devem ser copiadas para um objeto de saída via `out[key] =`:
// atribuir por colchetes a uma dessas dispara o setter herdado de
// `Object.prototype` (poluição de protótipo) em vez de criar uma propriedade
// própria comum — um blob armazenado malicioso (`{"__proto__":{...}}` vindo de
// JSON) não pode ser confiável.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Merge profundo: objetos simples mesclam recursivamente; arrays e
// primitivos do `patch` substituem o valor do `base`. Nunca compartilha
// referência com `base`/`patch` — todo objeto aninhado no resultado é uma
// cópia nova (via `structuredClone` ou recursão), então mutar o valor
// retornado nunca corrompe `DEFAULT_SETTINGS` nem o `patch` original. Ignora
// `__proto__`/`constructor`/`prototype` para não permitir poluição de
// protótipo a partir de um blob armazenado.
function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return isPlainObject(base) ? structuredClone(base) : patch;
  if (!isPlainObject(base)) return structuredClone(patch);
  const out = {};
  for (const key of Object.keys(base)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const baseVal = base[key];
    out[key] = isPlainObject(baseVal) ? structuredClone(baseVal) : baseVal;
  }
  for (const key of Object.keys(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const patchVal = patch[key];
    const baseVal = base[key];
    if (isPlainObject(baseVal) && isPlainObject(patchVal)) {
      out[key] = deepMerge(baseVal, patchVal);
    } else {
      out[key] = isPlainObject(patchVal) ? structuredClone(patchVal) : patchVal;
    }
  }
  return out;
}

export async function getSettings(storage) {
  const stored = await storage.get(SETTINGS_KEY);
  const current = stored && stored[SETTINGS_KEY];
  return deepMerge(structuredClone(DEFAULT_SETTINGS), current || {});
}

export async function saveSettings(storage, patch) {
  const stored = await storage.get(SETTINGS_KEY);
  const current = (stored && stored[SETTINGS_KEY]) || {};
  const merged = deepMerge(deepMerge(structuredClone(DEFAULT_SETTINGS), current), patch || {});
  await storage.set({ [SETTINGS_KEY]: merged });
  return merged;
}

export async function getPresets(storage, origin) {
  const key = presetsKey(origin);
  const stored = await storage.get(key);
  return (stored && stored[key]) || [];
}

async function savePresets(storage, origin, presets) {
  await storage.set({ [presetsKey(origin)]: presets });
}

export async function savePreset(storage, origin, { name, ops }) {
  const now = new Date().toISOString();
  const preset = {
    id: crypto.randomUUID(),
    name,
    ops,
    autoApply: false,
    createdAt: now,
    updatedAt: now,
  };
  const presets = await getPresets(storage, origin);
  presets.push(preset);
  await savePresets(storage, origin, presets);
  return preset;
}

export async function updatePreset(storage, origin, id, patch) {
  const presets = await getPresets(storage, origin);
  const idx = presets.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const updated = {
    ...presets[idx],
    ...patch,
    id: presets[idx].id,
    createdAt: presets[idx].createdAt,
    updatedAt: new Date().toISOString(),
  };
  presets[idx] = updated;
  await savePresets(storage, origin, presets);
  return updated;
}

export async function deletePreset(storage, origin, id) {
  const presets = await getPresets(storage, origin);
  const next = presets.filter((p) => p.id !== id);
  if (next.length === presets.length) return false;
  await savePresets(storage, origin, next);
  return true;
}

const MARKER_RE = /\[data-aise-id=(?:"([^"]+)"|'([^']+)'|([^\]\s]+))\]/g;

function replaceMarkers(text, bySelectorId) {
  return text.replace(MARKER_RE, (match, dq, sq, bare) => {
    const id = dq ?? sq ?? bare;
    return bySelectorId.has(id) ? bySelectorId.get(id) : match;
  });
}

// Substitui `[data-aise-id="sN"]` (aspas simples/duplas/sem aspas) pelo
// seletor estável correspondente em `selection`. Não muta `ops`; ids sem
// correspondência ficam como estão. Sempre reescreve `selector`; para
// `injectCSS` também reescreve `value` (o texto CSS — e portanto os
// marcadores de seletor dentro dele — mora em `value` nesse tipo de op).
export function stabilizeOps(ops, selection) {
  const bySelectorId = new Map(selection.map((item) => [item.id, item.selector]));
  return ops.map((op) => {
    const next = { ...op, selector: replaceMarkers(op.selector, bySelectorId) };
    if (op.op === "injectCSS") {
      next.value = replaceMarkers(op.value, bySelectorId);
    }
    return next;
  });
}
