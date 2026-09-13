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
  assert.equal((await getPresets(s, "https://x.com")).length, 1);
  assert.equal((await getPresets(s, "https://y.com")).length, 0);
  await updatePreset(s, "https://x.com", p.id, { autoApply: true });
  assert.equal((await getPresets(s, "https://x.com"))[0].autoApply, true);
  await deletePreset(s, "https://x.com", p.id);
  assert.equal((await getPresets(s, "https://x.com")).length, 0);
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
