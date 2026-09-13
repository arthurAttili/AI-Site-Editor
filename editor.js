// editor.js — página carregada por `editor.html` numa janela separada
// (chrome.windows.create type "popup"), aberta pelo botão ⧉ do painel
// flutuante. Mostra o mesmo editor da sidebar do DevTools, mas ligado à aba
// informada em `?tabId=`: a conversa com a porta `aise-devtools` mora em
// lib/port-client.js e a renderização em lib/ui/sidebar-view.js (variante
// "window"). Este arquivo é código de "cola": pode tocar
// `document`/`window`/`chrome` livremente.

import { createSidebarView } from "./lib/ui/sidebar-view.js";
import { createPortClient, applyReply, runAction, requestState } from "./lib/port-client.js";

const PORT_NAME = "aise-devtools";

const params = new URLSearchParams(location.search);
const tabId = Number.parseInt(params.get("tabId"), 10);

const root = document.getElementById("root");
const view = createSidebarView(
  document,
  root,
  {
    onSend,
    onPick,
    onDock,
    onUndo,
    onUndoAll,
    onRedoAll,
    onViewOriginal,
    onSavePreset,
    onOpenOptions,
  },
  { variant: "window" }
);

const client = createPortClient({
  connect: () => chrome.runtime.connect({ name: PORT_NAME }),
  tabId,
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (t) => window.clearTimeout(t),
  onConnected: () => requestState(client, view),
  onDisconnected: () => view.setConnection("disconnected"),
  onInitError: () => view.setError("Conexão com a extensão caiu; tentando de novo…"),
  onStateChanged: (state) => {
    view.setConnection("ok");
    view.setState(state);
    if (state && state.title) document.title = `Editor IA — ${state.title}`;
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

// Liga a mira na página e traz a aba para frente: o clique de seleção
// acontece lá, não aqui. Quando o content script termina a escolha, ele pede
// ao background para focar esta janela de novo.
function onPick() {
  runAction(view, client.send({ type: "TOGGLE_PICKER" })).then(() => {
    chrome.tabs.update(tabId, { active: true }).catch(() => {});
    chrome.tabs.get(tabId).then((tab) => chrome.windows.update(tab.windowId, { focused: true })).catch(() => {});
  });
}

function onDock() {
  client
    .send({ type: "DOCK_EDITOR" })
    .catch(() => {})
    .finally(() => window.close());
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
  chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (!Number.isInteger(tabId)) {
  view.setConnection("no-content");
  view.setError("Esta janela precisa ser aberta pelo botão ⧉ do editor na página.");
} else {
  view.setConnection("disconnected");
  client.start();
}
