import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { createOptionsView } from "../lib/ui/options-view.js";
import { PROVIDERS, COMPAT_PRESETS } from "../lib/providers/index.js";

const FULL_SETTINGS = {
  provider: "compat",
  language: "en-US",
  indicatorPosition: "top",
  providers: {
    claude: { apiKey: "sk-claude", model: "claude-opus-5" },
    gemini: { apiKey: "sk-gemini", model: "gemini-3.7-flash" },
    openai: { apiKey: "sk-openai", model: "gpt-5" },
    compat: { presetId: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "sk-compat", model: "llama-3.3-70b-versatile" },
  },
};

test("select de Provedor é populado a partir de PROVIDERS, na ordem e com os labels certos", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  createOptionsView(doc, root, {});

  const select = root.querySelector('[data-field="provider"]');
  const options = Array.from(select.querySelectorAll("option"));
  assert.deepEqual(
    options.map((o) => o.value),
    Object.keys(PROVIDERS)
  );
  for (const opt of options) {
    assert.equal(opt.textContent, PROVIDERS[opt.value].label);
  }
});

test("setSettings seguido de getSettings faz round-trip completo, incluindo os campos do compatível", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createOptionsView(doc, root, {});

  view.setSettings(FULL_SETTINGS);
  assert.deepEqual(view.getSettings(), FULL_SETTINGS);
});

test("getSettings recorta espaços nas strings", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createOptionsView(doc, root, {});

  view.setSettings(FULL_SETTINGS);
  root.querySelector('[data-field="language"]').value = "  pt-BR  ";
  root.querySelector('[data-field="providers.claude.apiKey"]').value = "  sk-x  ";
  const settings = view.getSettings();
  assert.equal(settings.language, "pt-BR");
  assert.equal(settings.providers.claude.apiKey, "sk-x");
});

test("trocar o Provedor mostra só a seção correspondente", () => {
  const { doc, win } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createOptionsView(doc, root, {});
  view.setSettings(FULL_SETTINGS);

  const select = root.querySelector('[data-field="provider"]');
  const sectionFor = (id) => root.querySelector(`[data-provider="${id}"]`);

  select.value = "compat";
  select.dispatchEvent(new win.Event("change", { bubbles: true }));
  assert.equal(sectionFor("compat").hidden, false);
  assert.equal(sectionFor("claude").hidden, true);
  assert.equal(sectionFor("gemini").hidden, true);
  assert.equal(sectionFor("openai").hidden, true);

  select.value = "claude";
  select.dispatchEvent(new win.Event("change", { bubbles: true }));
  assert.equal(sectionFor("claude").hidden, false);
  assert.equal(sectionFor("compat").hidden, true);
});

test("escolher um atalho do compatível preenche URL base e modelo e mostra 'sem chave' para ollama", () => {
  const { doc, win } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createOptionsView(doc, root, {});
  view.setSettings(FULL_SETTINGS);

  const presetSelect = root.querySelector('[data-field="compat.presetId"]');
  const options = Array.from(presetSelect.querySelectorAll("option"));
  assert.deepEqual(
    options.map((o) => o.value),
    COMPAT_PRESETS.map((p) => p.id)
  );

  const ollama = COMPAT_PRESETS.find((p) => p.id === "ollama");
  presetSelect.value = "ollama";
  presetSelect.dispatchEvent(new win.Event("change", { bubbles: true }));

  assert.equal(root.querySelector('[data-field="providers.compat.baseUrl"]').value, ollama.baseUrl);
  assert.equal(root.querySelector('[data-field="providers.compat.model"]').value, ollama.model);
  assert.equal(root.querySelector('[data-role="compat-no-key"]').hidden, false);
  assert.equal(root.querySelector('[data-role="compat-no-key"]').textContent, "sem chave");

  const groq = COMPAT_PRESETS.find((p) => p.id === "groq");
  presetSelect.value = "groq";
  presetSelect.dispatchEvent(new win.Event("change", { bubbles: true }));
  assert.equal(root.querySelector('[data-field="providers.compat.baseUrl"]').value, groq.baseUrl);
  assert.equal(root.querySelector('[data-role="compat-no-key"]').hidden, true);
});

test("botão Mostrar/Ocultar alterna o type do campo de chave", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createOptionsView(doc, root, {});
  view.setSettings(FULL_SETTINGS);

  const input = root.querySelector('[data-field="providers.claude.apiKey"]');
  const row = input.closest(".aise-key-row");
  const toggleBtn = row.querySelector('[data-action="toggle-key"]');

  assert.equal(input.type, "password");
  assert.equal(toggleBtn.textContent, "Mostrar");

  toggleBtn.click();
  assert.equal(input.type, "text");
  assert.equal(toggleBtn.textContent, "Ocultar");

  toggleBtn.click();
  assert.equal(input.type, "password");
  assert.equal(toggleBtn.textContent, "Mostrar");
});

test("setModels popula o datalist com um <option> por modelo", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createOptionsView(doc, root, {});

  view.setModels(["gpt-5", "gpt-5-mini"]);
  const datalist = root.querySelector("#aise-models");
  const options = Array.from(datalist.querySelectorAll("option"));
  assert.deepEqual(
    options.map((o) => o.value),
    ["gpt-5", "gpt-5-mini"]
  );

  view.setModels(["only-one"]);
  assert.equal(datalist.querySelectorAll("option").length, 1);
});

test("setTestResult renderiza sucesso e erro nas linhas de resultado de todas as seções", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createOptionsView(doc, root, {});

  view.setTestResult({ ok: true, model: "claude-opus-5" });
  const results = Array.from(root.querySelectorAll('[data-role="test-result"]'));
  assert.ok(results.length > 0);
  for (const el of results) {
    assert.equal(el.textContent, "✔ ok (modelo claude-opus-5)");
  }

  view.setTestResult({ ok: false, error: "Chave inválida." });
  for (const el of root.querySelectorAll('[data-role="test-result"]')) {
    assert.equal(el.textContent, "Chave inválida.");
  }

  view.setTestResult(null);
  for (const el of root.querySelectorAll('[data-role="test-result"]')) {
    assert.equal(el.textContent, "");
  }
});

test("Salvar chama onSave com as configurações atuais do formulário", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let saved = null;
  const view = createOptionsView(doc, root, { onSave: (patch) => { saved = patch; } });

  view.setSettings(FULL_SETTINGS);
  root.querySelector('[data-action="save"]').click();
  assert.deepEqual(saved, FULL_SETTINGS);
});

test("Testar conexão chama onTest com as configurações atuais", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let tested = null;
  const view = createOptionsView(doc, root, { onTest: (settings) => { tested = settings; } });

  view.setSettings(FULL_SETTINGS);
  root.querySelectorAll('[data-action="test"]')[0].click();
  assert.deepEqual(tested, FULL_SETTINGS);
});

test("Listar modelos chama onListModels com as configurações atuais", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let listed = null;
  const view = createOptionsView(doc, root, { onListModels: (settings) => { listed = settings; } });

  view.setSettings(FULL_SETTINGS);
  root.querySelector('[data-action="list-models"]').click();
  assert.deepEqual(listed, FULL_SETTINGS);
});

test("setBusy desabilita Salvar, Testar conexão e Listar modelos, e volta a habilitar", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createOptionsView(doc, root, {});

  view.setBusy(true);
  assert.equal(root.querySelector('[data-action="save"]').disabled, true);
  assert.equal(root.querySelector('[data-action="list-models"]').disabled, true);
  for (const btn of root.querySelectorAll('[data-action="test"]')) {
    assert.equal(btn.disabled, true);
  }

  view.setBusy(false);
  assert.equal(root.querySelector('[data-action="save"]').disabled, false);
  assert.equal(root.querySelector('[data-action="list-models"]').disabled, false);
});

test("showToast exibe a mensagem", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createOptionsView(doc, root, {});

  view.showToast("Opções salvas.");
  const toast = root.querySelector('[data-role="toast"]');
  assert.equal(toast.hidden, false);
  assert.equal(toast.textContent, "Opções salvas.");
});
