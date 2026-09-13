import test from "node:test";
import assert from "node:assert/strict";
import { getSettings, saveSettings, getPresets, savePreset, updatePreset, deletePreset, stabilizeOps, DEFAULT_SETTINGS } from "../lib/storage.js";

function memStorage() { const data = {}; return {
  async get(keys) { const ks = Array.isArray(keys) ? keys : [keys]; const out = {}; for (const k of ks) if (k in data) out[k] = structuredClone(data[k]); return out; },
  async set(obj) { Object.assign(data, structuredClone(obj)); }, data }; }

test("settings com defaults e merge", async () => {
  const s = memStorage();
  assert.deepEqual(await getSettings(s), DEFAULT_SETTINGS);
  await saveSettings(s, { provider: "gemini", providers: { gemini: { apiKey: "k" } } });
  const got = await getSettings(s);
  assert.equal(got.provider, "gemini");
  assert.equal(got.providers.gemini.apiKey, "k");
  assert.equal(got.providers.gemini.model, "gemini-3.7-flash");
  assert.equal(got.providers.claude.model, "claude-opus-5");
});
test("presets CRUD por origin, autoApply nasce falso", async () => {
  const s = memStorage();
  const p = await savePreset(s, "https://x.com", { name: "A", ops: [{ op: "remove", selector: "#a", name: "", value: "", position: "" }] });
  assert.equal(p.autoApply, false);
  assert.ok(p.id && p.createdAt);
  assert.deepEqual(p.history, [], "sem histórico informado nasce vazio");
  assert.equal(p.url, "");
  assert.equal(p.title, "");
  const hist = [{ n: 1, request: "r", summary: "s", undone: false, targets: [], records: [] }];
  const q = await savePreset(s, "https://x.com", { name: "B", ops: [], history: hist, url: "https://x.com/p", title: "P" });
  assert.deepEqual(q.history, hist);
  assert.equal(q.url, "https://x.com/p");
  assert.equal(q.title, "P");
  const stored = (await getPresets(s, "https://x.com")).find((x) => x.id === q.id);
  assert.deepEqual(stored.history, hist, "histórico persiste no storage");
  await deletePreset(s, "https://x.com", q.id);
  assert.equal((await getPresets(s, "https://x.com")).length, 1);
  assert.equal((await getPresets(s, "https://y.com")).length, 0);
  await updatePreset(s, "https://x.com", p.id, { autoApply: true });
  assert.equal((await getPresets(s, "https://x.com"))[0].autoApply, true);
  await deletePreset(s, "https://x.com", p.id);
  assert.equal((await getPresets(s, "https://x.com")).length, 0);
});
test("getSettings nunca compartilha referência com DEFAULT_SETTINGS", async () => {
  const original = structuredClone(DEFAULT_SETTINGS);
  const s = memStorage();
  const got = await getSettings(s);
  got.providers.claude.apiKey = "mutado";
  got.provider = "mutado";
  assert.deepEqual(DEFAULT_SETTINGS, original);
  const fresh = await getSettings(memStorage());
  assert.deepEqual(fresh, DEFAULT_SETTINGS);
});
test("deepMerge ignora __proto__/constructor/prototype de um blob armazenado", async () => {
  const s = memStorage();
  const malicious = JSON.parse('{"provider":"gemini","__proto__":{"polluted":true},"providers":{"__proto__":{"polluted":true},"claude":{"apiKey":"k"}}}');
  await s.set({ settings: malicious });
  const got = await getSettings(s);
  assert.equal(Object.getPrototypeOf(got), Object.prototype);
  assert.equal(got.polluted, undefined);
  assert.equal(({}).polluted, undefined);
  assert.equal(got.provider, "gemini");
  assert.equal(got.providers.claude.apiKey, "k");
});
test("updatePreset preserva createdAt mesmo se o patch tentar sobrescrever", async () => {
  const s = memStorage();
  const p = await savePreset(s, "https://x.com", { name: "A", ops: [] });
  const updated = await updatePreset(s, "https://x.com", p.id, { createdAt: "2000-01-01T00:00:00.000Z" });
  assert.equal(updated.createdAt, p.createdAt);
});
test("stabilizeOps troca marcadores por seletores estáveis", () => {
  const out = stabilizeOps([
    { op: "setStyle", selector: '[data-aise-id="s1"]', name: "color", value: "red", position: "" },
    { op: "setStyle", selector: "[data-aise-id='s2'] a", name: "color", value: "red", position: "" },
    { op: "injectCSS", selector: "", name: "", value: "[data-aise-id=s1]{x:y}", position: "" },
  ], [{ id: "s1", selector: "#a" }, { id: "s2", selector: "nav.menu" }]);
  assert.equal(out[0].selector, "#a");
  assert.equal(out[1].selector, "nav.menu a");
  assert.equal(out[2].value, "#a{x:y}");
});
