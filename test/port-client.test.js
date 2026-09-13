import test from "node:test";
import assert from "node:assert/strict";
import { createPortClient, applyReply, runAction, requestState, DISCONNECTED_ERROR, TIMEOUT_ERROR } from "../lib/port-client.js";

// Porta falsa com o mesmo contrato de chrome.runtime.Port.
function makeFakePort() {
  const port = {
    sent: [],
    msgListeners: [],
    discListeners: [],
    postMessage(m) { port.sent.push(m); },
    onMessage: { addListener(fn) { port.msgListeners.push(fn); } },
    onDisconnect: { addListener(fn) { port.discListeners.push(fn); } },
    disconnect() {},
    emit(m) { for (const fn of port.msgListeners) fn(m); },
    drop() { for (const fn of port.discListeners) fn(); },
  };
  return port;
}

// Timers manuais: `flush()` dispara tudo que está agendado.
function makeTimers() {
  let id = 0;
  const scheduled = new Map();
  return {
    setTimeout(fn, ms) { const t = ++id; scheduled.set(t, { fn, ms }); return t; },
    clearTimeout(t) { scheduled.delete(t); },
    flush() { const list = [...scheduled.entries()]; scheduled.clear(); for (const [, s] of list) s.fn(); },
    pending: () => [...scheduled.values()],
  };
}

test("start envia INIT com tabId; send resolve com a REPLY do reqId certo", async () => {
  const ports = [];
  const timers = makeTimers();
  const states = [];
  const client = createPortClient({
    connect: () => { const p = makeFakePort(); ports.push(p); return p; },
    tabId: 42,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onStateChanged: (s) => states.push(s),
  });
  client.start();
  assert.deepEqual(ports[0].sent[0], { type: "INIT", tabId: 42 });
  const p1 = client.send({ type: "GET_STATE" });
  const p2 = client.send({ type: "UNDO", requestId: "r1" });
  assert.equal(ports[0].sent[1].reqId, 1);
  assert.deepEqual(ports[0].sent[2], { type: "UNDO", requestId: "r1", reqId: 2 });
  ports[0].emit({ type: "REPLY", reqId: 2, reply: { ok: true, state: { n: 2 } } });
  ports[0].emit({ type: "REPLY", reqId: 1, reply: { ok: true, state: { n: 1 } } });
  assert.deepEqual(await p1, { ok: true, state: { n: 1 } });
  assert.deepEqual(await p2, { ok: true, state: { n: 2 } });
  ports[0].emit({ type: "STATE_CHANGED", state: { activeCount: 3 } });
  assert.deepEqual(states, [{ activeCount: 3 }]);
  assert.equal(timers.pending().length, 0, "timers das respostas foram limpos");
});

test("desconexão rejeita pendentes, reconecta com backoff e send sem porta falha na hora", async () => {
  const ports = [];
  const timers = makeTimers();
  let disconnected = 0;
  let connected = 0;
  const client = createPortClient({
    connect: () => { const p = makeFakePort(); ports.push(p); return p; },
    tabId: 1,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    reconnectDelayMs: 100,
    reconnectDelayMaxMs: 300,
    onConnected: () => connected++,
    onDisconnected: () => disconnected++,
  });
  client.start();
  const pending = client.send({ type: "GET_STATE" });
  ports[0].drop();
  await assert.rejects(pending, { message: DISCONNECTED_ERROR });
  assert.equal(disconnected, 1);
  assert.equal(client.isConnected(), false);
  await assert.rejects(client.send({ type: "GET_STATE" }), { message: DISCONNECTED_ERROR });
  assert.equal(timers.pending()[0].ms, 100);
  timers.flush();
  assert.equal(ports.length, 2);
  assert.equal(connected, 2);
  ports[1].drop();
  assert.equal(timers.pending()[0].ms, 200);
  timers.flush();
  ports[2].drop();
  assert.equal(timers.pending()[0].ms, 300, "backoff satura no máximo");
  timers.flush();
  ports[3].drop();
  assert.equal(timers.pending()[0].ms, 300);
  client.stop();
  timers.flush();
  assert.equal(ports.length, 4, "após stop não reconecta");
  assert.equal(timers.pending().length, 0, "após stop não reagenda");
});

test("timeout rejeita e postMessage que lança rejeita sem deixar timer", async () => {
  const timers = makeTimers();
  const port = makeFakePort();
  const client = createPortClient({ connect: () => port, tabId: 1, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, requestTimeoutMs: 10 });
  client.start();
  const p = client.send({ type: "REQUEST_EDIT", text: "x" });
  timers.flush();
  await assert.rejects(p, { message: TIMEOUT_ERROR });
  port.postMessage = () => { throw new Error("porta morta"); };
  await assert.rejects(client.send({ type: "GET_STATE" }), { message: "porta morta" });
  assert.equal(timers.pending().length, 0);
});

test("INIT que lança chama onInitError sem derrubar o start", () => {
  const timers = makeTimers();
  const port = makeFakePort();
  port.postMessage = () => { throw new Error("disconnected port"); };
  let initErrors = 0;
  const client = createPortClient({ connect: () => port, tabId: 1, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, onInitError: () => initErrors++ });
  client.start();
  assert.equal(initErrors, 1);
  assert.equal(port.msgListeners.length, 1);
});

test("applyReply/runAction/requestState atualizam a view", async () => {
  const calls = [];
  const view = { setState: (s) => calls.push(["state", s]), setError: (e) => calls.push(["error", e]), setConnection: (c) => calls.push(["conn", c]) };
  assert.equal(applyReply(view, { ok: true, state: { a: 1 } }), true);
  assert.equal(applyReply(view, { ok: false, error: "x" }), false);
  assert.equal(applyReply(view, null), false);
  await runAction(view, Promise.reject(new Error("boom")));
  const client = { send: async () => ({ ok: false, error: "sem content" }) };
  await requestState(client, view);
  const client2 = { send: async () => ({ ok: true, state: { b: 2 } }) };
  await requestState(client2, view);
  assert.deepEqual(calls, [
    ["error", null], ["state", { a: 1 }],
    ["error", "x"],
    ["error", "Falha desconhecida."],
    ["error", "boom"],
    ["conn", "no-content"], ["error", "sem content"],
    ["conn", "ok"], ["error", null], ["state", { b: 2 }],
  ]);
});
