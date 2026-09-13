// options.js — página de Opções (Task 14). Único responsável por falar com
// `chrome.storage.local` e `chrome.runtime`; a renderização em si mora em
// lib/ui/options-view.js (módulo puro, testado à parte). Este arquivo é
// código de "cola": pode tocar `document`/`window`/`chrome` livremente.

import { getSettings, saveSettings } from "./lib/storage.js";
import { createOptionsView } from "./lib/ui/options-view.js";

const root = document.getElementById("root");
const view = createOptionsView(document, root, {
  onSave,
  onTest,
  onListModels,
});

async function onSave(patch) {
  view.setBusy(true);
  try {
    await saveSettings(chrome.storage.local, patch);
    view.showToast("Opções salvas.");
  } catch (err) {
    view.setTestResult({ ok: false, error: (err && err.message) || String(err) });
  }
  view.setBusy(false);
}

async function onTest(settings) {
  view.setBusy(true);
  try {
    const reply = await chrome.runtime.sendMessage({ type: "TEST_PROVIDER", settings });
    view.setTestResult(reply);
  } catch (err) {
    view.setTestResult({ ok: false, error: (err && err.message) || String(err) });
  }
  view.setBusy(false);
}

async function onListModels(settings) {
  view.setBusy(true);
  try {
    const reply = await chrome.runtime.sendMessage({ type: "LIST_MODELS", settings });
    if (reply && reply.ok) {
      view.setModels(reply.models);
    } else {
      view.setTestResult({ ok: false, error: (reply && reply.error) || "Falha desconhecida." });
    }
  } catch (err) {
    view.setTestResult({ ok: false, error: (err && err.message) || String(err) });
  }
  view.setBusy(false);
}

async function init() {
  const settings = await getSettings(chrome.storage.local);
  view.setSettings(settings);
}

init();
