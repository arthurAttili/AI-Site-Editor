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

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Merge profundo: objetos simples mesclam recursivamente; arrays e
// primitivos do `patch` substituem o valor do `base`. Não muta os argumentos.
function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    const patchVal = patch[key];
    const baseVal = base[key];
    out[key] = isPlainObject(baseVal) && isPlainObject(patchVal) ? deepMerge(baseVal, patchVal) : patchVal;
  }
  return out;
}

export async function getSettings(storage) {
  const stored = await storage.get(SETTINGS_KEY);
  const current = stored && stored[SETTINGS_KEY];
  return deepMerge(DEFAULT_SETTINGS, current || {});
}

export async function saveSettings(storage, patch) {
  const stored = await storage.get(SETTINGS_KEY);
  const current = (stored && stored[SETTINGS_KEY]) || {};
  const merged = deepMerge(deepMerge(DEFAULT_SETTINGS, current), patch || {});
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
  const updated = { ...presets[idx], ...patch, id: presets[idx].id, updatedAt: new Date().toISOString() };
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
// correspondência ficam como estão. Reescreve `selector`; para `injectCSS`
// (cujo texto CSS — e portanto os marcadores de seletor — mora em `value`,
// já que esse op não usa `selector`) reescreve `value` em vez disso.
export function stabilizeOps(ops, selection) {
  const bySelectorId = new Map(selection.map((item) => [item.id, item.selector]));
  return ops.map((op) => {
    if (op.op === "injectCSS") {
      return { ...op, value: replaceMarkers(op.value, bySelectorId) };
    }
    return { ...op, selector: replaceMarkers(op.selector, bySelectorId) };
  });
}
