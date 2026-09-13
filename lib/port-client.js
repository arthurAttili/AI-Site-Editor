// lib/port-client.js — cliente da porta `aise-devtools` do background, usado
// pela sidebar do DevTools (sidebar.js) e pela janela separada do editor
// (editor.js). Módulo puro: `connect` e os timers entram por injeção, nada de
// `chrome`/`window` globais — assim dá para testar com uma porta falsa.
//
// Protocolo (ver background.js): primeira mensagem `{type:"INIT", tabId}`;
// depois qualquer `{type, reqId, ...}` é repassado ao content script da aba e
// respondido com `{type:"REPLY", reqId, reply}`; `{type:"STATE_CHANGED",
// state}` chega sempre que a página muda de estado.

export const DEFAULT_REQUEST_TIMEOUT_MS = 200000; // cobre os até 3min de REQUEST_EDIT com folga
export const DEFAULT_RECONNECT_DELAY_MS = 500;
export const DEFAULT_RECONNECT_DELAY_MAX_MS = 5000;
export const DISCONNECTED_ERROR = "Desconectado da extensão.";
export const TIMEOUT_ERROR = "Tempo esgotado aguardando resposta da extensão.";

export function createPortClient({
  connect,
  tabId,
  setTimeout,
  clearTimeout,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  reconnectDelayMaxMs = DEFAULT_RECONNECT_DELAY_MAX_MS,
  onConnected,
  onDisconnected,
  onInitError,
  onStateChanged,
} = {}) {
  let port = null;
  let reqCounter = 0;
  const pending = new Map(); // reqId → {resolve, reject, timer}
  let reconnectDelay = reconnectDelayMs;
  let stopped = false;

  function onPortMessage(msg) {
    if (!msg) return;
    // Só uma mensagem de verdade prova que a porta está viva: o backoff volta
    // ao início aqui, não no connect (um service worker que cai logo após o
    // connect não pode zerar a espera a cada tentativa).
    reconnectDelay = reconnectDelayMs;
    if (msg.type === "REPLY") {
      const entry = pending.get(msg.reqId);
      if (!entry) return;
      pending.delete(msg.reqId);
      clearTimeout(entry.timer);
      entry.resolve(msg.reply);
      return;
    }
    if (msg.type === "STATE_CHANGED") onStateChanged?.(msg.state);
  }

  function onPortDisconnect() {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(DISCONNECTED_ERROR));
    }
    pending.clear();
    port = null;
    onDisconnected?.();
    if (stopped) return;
    setTimeout(open, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectDelayMaxMs);
  }

  function open() {
    if (stopped) return;
    port = connect();
    // O service worker pode ter sido descarregado entre o connect e o INIT:
    // aí o postMessage lança e derrubaria o boot inteiro da página. O
    // onDisconnect reagenda a reconexão.
    try {
      port.postMessage({ type: "INIT", tabId });
    } catch {
      onInitError?.();
    }
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(onPortDisconnect);
    onConnected?.();
  }

  function send(msg) {
    return new Promise((resolve, reject) => {
      if (!port) {
        reject(new Error(DISCONNECTED_ERROR));
        return;
      }
      const reqId = ++reqCounter;
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error(TIMEOUT_ERROR));
      }, requestTimeoutMs);
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

  function stop() {
    stopped = true;
    if (port) {
      try {
        port.disconnect?.();
      } catch {
        // porta já morta
      }
    }
  }

  return { start: open, send, stop, isConnected: () => port != null };
}

// Helpers compartilhados pelas páginas que exibem o estado remoto: aplicam
// a resposta `{ok, state | error}` do content script numa view com
// `setState`/`setError` (e `setConnection` no caso de `requestState`).

export function applyReply(view, reply, fallback = "Falha desconhecida.") {
  if (reply && reply.ok) {
    view.setError(null);
    view.setState(reply.state);
    return true;
  }
  view.setError((reply && reply.error) || fallback);
  return false;
}

// Fluxo comum das ações que só pedem "aplica e re-renderiza".
export function runAction(view, promise) {
  return promise.then((reply) => applyReply(view, reply)).catch((err) => view.setError(err.message));
}

// Busca o estado atual e usa o sucesso/falha do GET_STATE para decidir se há
// content script vivo na aba ("ok" vs. "no-content" — a porta em si já está
// de pé).
export function requestState(client, view) {
  return client
    .send({ type: "GET_STATE" })
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
    .catch((err) => view.setError(err.message));
}
