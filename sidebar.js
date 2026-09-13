// sidebar.js — página carregada por `sidebar.html` dentro da sidebar
// "Editor IA" (aba Elements do DevTools). Único responsável por falar com o
// `chrome.devtools.*` e por rodar os `eval` no contexto da página
// inspecionada; a conversa com a porta `aise-devtools` do background mora em
// lib/port-client.js e a renderização em lib/ui/sidebar-view.js (módulos
// puros, testados à parte). Este arquivo é código de "cola": pode tocar
// `document`/`window`/`chrome` livremente.

import { createSidebarView } from "./lib/ui/sidebar-view.js";
import { createPortClient, applyReply, runAction, requestState } from "./lib/port-client.js";

const PORT_NAME = "aise-devtools";

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

const client = createPortClient({
  connect: () => chrome.runtime.connect({ name: PORT_NAME }),
  tabId: chrome.devtools.inspectedWindow.tabId,
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (t) => window.clearTimeout(t),
  onConnected: () => requestState(client, view),
  onDisconnected: () => view.setConnection("disconnected"),
  onInitError: () => view.setError("Conexão com a extensão caiu; tentando de novo…"),
  onStateChanged: (state) => {
    view.setConnection("ok");
    view.setState(state);
  },
});

// ---------------------------------------------------------------------------
// Handlers da view
// ---------------------------------------------------------------------------

function onSend(text) {
  view.setBusy(true);
  client
    .send({ type: "REQUEST_EDIT", text })
    .then((reply) => applyReply(view, reply))
    .catch((err) => view.setError(err.message))
    .finally(() => view.setBusy(false));
}

function onUseSelected() {
  chrome.devtools.inspectedWindow.eval(MARK_SELECTED_EVAL, (_result, exceptionInfo) => {
    // Dois canais de erro distintos: `lastError` (a chamada nem chegou à
    // página — aba fechada, contexto invalidado) e `exceptionInfo` (o eval
    // rodou e falhou, ou foi recusado pela política da página).
    if (chrome.runtime.lastError || exceptionInfo) {
      view.setError("Não foi possível usar o elemento selecionado.");
      return;
    }
    runAction(view, client.send({ type: "PICK_MARKED" }));
  });
}

function onUndo(requestId) {
  runAction(view, client.send({ type: "UNDO", requestId }));
}

function onUndoAll() {
  runAction(view, client.send({ type: "UNDO_ALL" }));
}

function onRedoAll() {
  runAction(view, client.send({ type: "REDO_ALL" }));
}

function onViewOriginal() {
  runAction(view, client.send({ type: "TOGGLE_ORIGINAL" }));
}

function onSavePreset() {
  const name = window.prompt("Nome do preset:");
  if (!name) return; // cancelado silenciosamente
  runAction(view, client.send({ type: "SAVE_PRESET", name }));
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
    if (chrome.runtime.lastError || exceptionInfo || !result) {
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
client.start();
updateInspectedLabel();
