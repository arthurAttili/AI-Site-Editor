// sidebar.js — página carregada por `sidebar.html` dentro da sidebar
// "Editor IA" (aba Elements do DevTools). Único responsável por falar com o
// `chrome.devtools.*`, com a porta `aise-devtools` do background (Task 9) e
// por rodar os `eval` no contexto da página inspecionada; a renderização em
// si mora em lib/ui/sidebar-view.js (módulo puro, testado à parte). Este
// arquivo é código de "cola": pode tocar `document`/`window`/`chrome`
// livremente.

import { createSidebarView } from "./lib/ui/sidebar-view.js";

const PORT_NAME = "aise-devtools";
const REQUEST_TIMEOUT_MS = 200000; // 200s — cobre os até 3min de REQUEST_EDIT com folga de handshake
const RECONNECT_DELAY_MS_INITIAL = 500;
const RECONNECT_DELAY_MS_MAX = 5000;
const DISCONNECTED_ERROR = "Desconectado da extensão. Feche e reabra o DevTools.";

const INSPECTED_LABEL_EVAL =
  "(()=>{const e=$0;if(!e)return '';return e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.classList.length?'.'+[...e.classList].slice(0,2).join('.'):'')})()";
const MARK_SELECTED_EVAL = "$0&&$0.setAttribute('data-aise-pick','1')";

const root = document.getElementById("root");
const view = createSidebarView(document, root, {
  onSend,
  onUseSelected,
  onUndo,
  onUndoAll,
  onRedoAll,
  onViewOriginal,
  onSavePreset,
  onOpenOptions,
});

let port = null;
let reqCounter = 0;
const pending = new Map(); // reqId → {resolve, reject, timer}
let reconnectDelay = RECONNECT_DELAY_MS_INITIAL;

// ---------------------------------------------------------------------------
// Porta com o background
// ---------------------------------------------------------------------------

function connectPort() {
  port = chrome.runtime.connect({ name: PORT_NAME });
  port.postMessage({ type: "INIT", tabId: chrome.devtools.inspectedWindow.tabId });
  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(onPortDisconnect);
  reconnectDelay = RECONNECT_DELAY_MS_INITIAL;
  requestState();
}

function onPortDisconnect() {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error(DISCONNECTED_ERROR));
  }
  pending.clear();
  view.setConnection("disconnected");
  setTimeout(connectPort, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_DELAY_MS_MAX);
}

function onPortMessage(msg) {
  if (!msg) return;
  if (msg.type === "REPLY") {
    const entry = pending.get(msg.reqId);
    if (!entry) return;
    pending.delete(msg.reqId);
    clearTimeout(entry.timer);
    entry.resolve(msg.reply);
    return;
  }
  if (msg.type === "STATE_CHANGED") {
    view.setConnection("ok");
    view.setState(msg.state);
  }
}

function send(msg) {
  return new Promise((resolve, reject) => {
    const reqId = ++reqCounter;
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error("Tempo esgotado aguardando resposta da extensão."));
    }, REQUEST_TIMEOUT_MS);
    pending.set(reqId, { resolve, reject, timer });
    try {
      port.postMessage({ ...msg, reqId });
    } catch (err) {
      clearTimeout(timer);
      pending.delete(reqId);
      reject(err);
    }
  });
}

// Ponto único usado tanto no boot quanto após reconectar: busca o estado
// atual e usa o sucesso/falha do GET_STATE para decidir se há content script
// vivo nesta aba ("ok" vs. "no-content" — a porta em si já está de pé).
function requestState() {
  send({ type: "GET_STATE" })
    .then((reply) => {
      if (reply && reply.ok) {
        view.setConnection("ok");
        view.setError(null);
        view.setState(reply.state);
      } else {
        view.setConnection("no-content");
        view.setError((reply && reply.error) || null);
      }
    })
    .catch((err) => {
      view.setError(err.message);
    });
}

// Fluxo comum das ações que só pedem "aplica e re-renderiza": undo, undo-all,
// redo-all, toggle-original, salvar preset e usar-elemento-selecionado.
function runAction(promise) {
  promise
    .then((reply) => {
      if (reply && reply.ok) {
        view.setError(null);
        view.setState(reply.state);
      } else {
        view.setError((reply && reply.error) || "Falha desconhecida.");
      }
    })
    .catch((err) => {
      view.setError(err.message);
    });
}

// ---------------------------------------------------------------------------
// Handlers da view
// ---------------------------------------------------------------------------

function onSend(text) {
  view.setBusy(true);
  send({ type: "REQUEST_EDIT", text })
    .then((reply) => {
      if (reply && reply.ok) {
        view.setError(null);
        view.setState(reply.state);
      } else {
        view.setError((reply && reply.error) || "Falha desconhecida.");
      }
    })
    .catch((err) => {
      view.setError(err.message);
    })
    .finally(() => view.setBusy(false));
}

function onUseSelected() {
  chrome.devtools.inspectedWindow.eval(MARK_SELECTED_EVAL, (_result, exceptionInfo) => {
    if (exceptionInfo) {
      view.setError("Não foi possível usar o elemento selecionado.");
      return;
    }
    runAction(send({ type: "PICK_MARKED" }));
  });
}

function onUndo(requestId) {
  runAction(send({ type: "UNDO", requestId }));
}

function onUndoAll() {
  runAction(send({ type: "UNDO_ALL" }));
}

function onRedoAll() {
  runAction(send({ type: "REDO_ALL" }));
}

function onViewOriginal() {
  runAction(send({ type: "TOGGLE_ORIGINAL" }));
}

function onSavePreset() {
  const name = window.prompt("Nome do preset:");
  if (!name) return; // cancelado silenciosamente
  runAction(send({ type: "SAVE_PRESET", name }));
}

function onOpenOptions() {
  // Vai direto para o background — não passa pela porta do DevTools.
  chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
}

// ---------------------------------------------------------------------------
// Elemento inspecionado ($0)
// ---------------------------------------------------------------------------

function updateInspectedLabel() {
  chrome.devtools.inspectedWindow.eval(INSPECTED_LABEL_EVAL, (result, exceptionInfo) => {
    if (exceptionInfo || !result) {
      view.setInspected("");
      return;
    }
    view.setInspected(result);
  });
}

chrome.devtools.panels.elements.onSelectionChanged.addListener(updateInspectedLabel);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

view.setConnection("disconnected");
connectPort();
updateInspectedLabel();
