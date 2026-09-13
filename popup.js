// popup.js — página do popup da toolbar (Task 13). Único responsável por
// falar com `chrome.tabs`, `chrome.scripting`, `chrome.runtime` e
// `chrome.storage.local`; a renderização em si mora em
// lib/ui/popup-view.js (módulo puro, testado à parte). Este arquivo é
// código de "cola": pode tocar `document`/`window`/`chrome` livremente.

import { getPresets, updatePreset, deletePreset } from "./lib/storage.js";
import { createPopupView } from "./lib/ui/popup-view.js";

const UNEDITABLE_TEXT = "Esta página não pode ser editada";

const root = document.getElementById("root");
const view = createPopupView(document, root, {
  onToggleOriginal,
  onUndoAll,
  onApplyPreset,
  onSetAutoApply,
  onRemovePreset,
  onOpenOptions,
});

let tabId = null;
let origin = null;
let presetsCache = [];

// GET_STATE pode chegar antes do content script terminar de carregar (aba
// recém-aberta) ou nunca — nesse caso injeta `content.js` uma vez e tenta de
// novo; se ainda assim falhar, `setState(null)` (badge "extensão não
// carregada nesta aba", conforme regra do controller para a Task 13).
async function getStateWithRetry(id) {
  try {
    return await chrome.tabs.sendMessage(id, { type: "GET_STATE" });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] });
    } catch {
      return null;
    }
    try {
      return await chrome.tabs.sendMessage(id, { type: "GET_STATE" });
    } catch {
      return null;
    }
  }
}

async function refreshState() {
  const reply = await getStateWithRetry(tabId);
  if (reply && reply.ok) {
    view.setState(reply.state);
  } else {
    view.setState(null);
  }
}

async function refreshPresets() {
  presetsCache = await getPresets(chrome.storage.local, origin);
  view.setPresets(presetsCache);
}

async function refreshAll() {
  await refreshState();
  await refreshPresets();
}

// Mensagens que esperam `{ok:true, state}`: qualquer outra coisa (recusa
// lógica do content script, ex. "Saia do modo original…", ou a promise
// rejeitando por falta de listener) vira exceção — `runAction` trata tudo
// igual, mostrando a mensagem em `setError`.
async function sendAction(type, extra = {}) {
  const reply = await chrome.tabs.sendMessage(tabId, { type, ...extra });
  if (!reply || !reply.ok) throw new Error((reply && reply.error) || "Falha desconhecida.");
  return reply;
}

// Fluxo comum de toda ação do popup: roda `fn`, sempre re-busca estado e
// presets em seguida (mesmo se `fn` falhou) e reporta qualquer erro via
// `setError` — nunca deixa uma exceção escapar para o console do popup.
async function runAction(fn) {
  view.setBusy(true);
  try {
    await fn();
    view.setError(null);
  } catch (err) {
    view.setError((err && err.message) || String(err));
  }
  try {
    await refreshAll();
  } catch (err) {
    view.setError((err && err.message) || String(err));
  }
  view.setBusy(false);
}

function onToggleOriginal() {
  runAction(() => sendAction("TOGGLE_ORIGINAL"));
}

function onUndoAll() {
  runAction(() => sendAction("UNDO_ALL"));
}

function onApplyPreset(id) {
  runAction(() => sendAction("APPLY_PRESET", { presetId: id }));
}

// Ligar auto-aplicar só grava no storage — não aplica agora. Desligar para
// um preset que já está aplicado na aba também não muda nada na página
// (o aviso de "só no próximo carregamento" é do lado do content script);
// aqui só re-renderiza com o valor novo.
function onSetAutoApply(id, value) {
  runAction(() => updatePreset(chrome.storage.local, origin, id, { autoApply: value }));
}

function onRemovePreset(id) {
  const preset = presetsCache.find((p) => p.id === id);
  const name = preset ? preset.name : "";
  if (!window.confirm(`Remover o preset '${name}'?`)) return;
  runAction(() => deletePreset(chrome.storage.local, origin, id));
}

function onOpenOptions() {
  chrome.runtime.openOptionsPage();
}

function isEditableUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !isEditableUrl(tab.url)) {
    view.setUneditable(UNEDITABLE_TEXT);
    return;
  }
  tabId = tab.id;
  origin = new URL(tab.url).origin;
  await refreshAll();
}

init().catch((err) => {
  view.setError((err && err.message) || String(err));
});
