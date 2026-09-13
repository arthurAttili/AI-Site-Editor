import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { createSession } from "../lib/session.js";
import { applyOps, undoRecords, redoRecords } from "../lib/ops.js";
import { stabilizeOps } from "../lib/storage.js";
import { sanitizeHTML } from "../lib/sanitize.js";

function makeSession(doc, win) {
  return createSession({
    doc,
    win,
    applyOps,
    undoRecords,
    redoRecords,
    stabilizeOps,
    sanitize: (html) => sanitizeHTML(html, doc),
  });
}

test("selectOnly then toggle adds and removes an element, ids re-tagged s1..sN", () => {
  const { doc, win } = makeDoc("<body><p id='a'>a</p><b id='b'>b</b></body>");
  const session = makeSession(doc, win);
  const a = doc.getElementById("a");
  const b = doc.getElementById("b");

  session.selectOnly(a);
  assert.deepEqual(session.getSelection().map((s) => s.id), ["s1"]);
  assert.equal(a.getAttribute("data-aise-id"), "s1");

  session.toggle(b);
  assert.deepEqual(session.getSelection().map((s) => s.id), ["s1", "s2"]);
  assert.equal(b.getAttribute("data-aise-id"), "s2");

  session.toggle(a);
  const sel = session.getSelection();
  assert.deepEqual(sel.map((s) => s.id), ["s1"]);
  assert.equal(sel[0].el, b);
  assert.equal(b.getAttribute("data-aise-id"), "s1");
  assert.equal(a.hasAttribute("data-aise-id"), false);
});

test("remove and clear untag elements", () => {
  const { doc, win } = makeDoc("<body><p id='a'>a</p><b id='b'>b</b></body>");
  const session = makeSession(doc, win);
  const a = doc.getElementById("a");
  const b = doc.getElementById("b");
  session.selectOnly(a);
  session.toggle(b);
  const idOfA = session.getSelection()[0].id;
  session.remove(idOfA);
  assert.deepEqual(session.getSelection().map((s) => s.el), [b]);
  assert.equal(a.hasAttribute("data-aise-id"), false);
  session.clear();
  assert.deepEqual(session.getSelection(), []);
  assert.equal(b.hasAttribute("data-aise-id"), false);
});

test("addRequest applies ops, history/activeCount reflect it; undo/redo work", () => {
  const { doc, win } = makeDoc("<body><p id='a' style='color: blue'>oi</p></body>");
  const session = makeSession(doc, win);
  const a = doc.getElementById("a");
  session.selectOnly(a);

  const ops = [{ op: "setStyle", selector: "#a", name: "color", value: "red", position: "" }];
  const entry = session.addRequest({ request: "deixe vermelho", summary: "cor vermelha", ops });

  assert.equal(a.style.color, "red");
  assert.equal(entry.undone, false);
  assert.equal(entry.n, 1);
  assert.ok(entry.id);
  assert.equal(session.activeCount(), 1);

  const state = session.publicState({ origin: "https://x.com", url: "https://x.com/", title: "T" });
  assert.equal(state.history.length, 1);
  assert.deepEqual(state.history[0], {
    id: entry.id,
    n: 1,
    request: "deixe vermelho",
    summary: "cor vermelha",
    undone: false,
    opsCount: 1,
  });
  assert.equal(state.activeCount, 1);

  session.undoRequest(entry.id);
  assert.equal(a.style.color, "blue");
  assert.equal(session.activeCount(), 0);
  assert.equal(session.publicState({}).history[0].undone, true);

  session.redoRequest(entry.id);
  assert.equal(a.style.color, "red");
  assert.equal(session.activeCount(), 1);
  assert.equal(session.publicState({}).history[0].undone, false);
});

test("toggleOriginal reverts active entries without marking them undone, then restores; user-undone entries stay undone", () => {
  const { doc, win } = makeDoc("<body><p id='a'>oi</p><p id='b'>tchau</p></body>");
  const session = makeSession(doc, win);

  session.selectOnly(doc.getElementById("a"));
  const e1 = session.addRequest({
    request: "1",
    summary: "s1",
    ops: [{ op: "setStyle", selector: "#a", name: "color", value: "red", position: "" }],
  });
  session.selectOnly(doc.getElementById("b"));
  const e2 = session.addRequest({
    request: "2",
    summary: "s2",
    ops: [{ op: "setStyle", selector: "#b", name: "color", value: "green", position: "" }],
  });

  // user explicitly undoes e1 before toggling original mode
  session.undoRequest(e1.id);
  assert.equal(doc.getElementById("a").style.color, "");
  assert.equal(session.activeCount(), 1);

  session.toggleOriginal();
  assert.equal(session.originalMode, true);
  assert.equal(doc.getElementById("b").style.color, "");
  assert.equal(session.activeCount(), 0);
  const historyDuringOriginal = session.publicState({}).history;
  assert.equal(historyDuringOriginal.find((h) => h.id === e1.id).undone, true, "user-undone entry stays undone");
  assert.equal(historyDuringOriginal.find((h) => h.id === e2.id).undone, false, "toggled-off entry is not marked undone");

  session.toggleOriginal();
  assert.equal(session.originalMode, false);
  assert.equal(doc.getElementById("b").style.color, "green");
  assert.equal(doc.getElementById("a").style.color, "", "entry undone by the user before toggling stays undone");
  assert.equal(session.activeCount(), 1);
});

test("undoRequest and redoRequest are blocked (no-op) while originalMode is on", () => {
  const { doc, win } = makeDoc("<body><p id='a'>oi</p></body>");
  const session = makeSession(doc, win);
  session.selectOnly(doc.getElementById("a"));
  const entry = session.addRequest({
    request: "1",
    summary: "s1",
    ops: [{ op: "setStyle", selector: "#a", name: "color", value: "red", position: "" }],
  });
  assert.equal(doc.getElementById("a").style.color, "red");

  session.toggleOriginal();
  assert.equal(doc.getElementById("a").style.color, "", "DOM reverted to original by toggleOriginal");

  const undoResult = session.undoRequest(entry.id);
  assert.equal(undoResult, false, "undoRequest is a no-op while originalMode is on");
  assert.equal(doc.getElementById("a").style.color, "", "DOM stays as original after the blocked undoRequest");

  const redoResult = session.redoRequest(entry.id);
  assert.equal(redoResult, false, "redoRequest is a no-op while originalMode is on");
  assert.equal(doc.getElementById("a").style.color, "", "DOM still stays as original after the blocked redoRequest");

  session.toggleOriginal();
  assert.equal(doc.getElementById("a").style.color, "red", "entry is reactivated exactly once when leaving original mode");
  assert.equal(session.activeCount(), 1);
});

test("collectPresetOps rewrites [data-aise-id=\"s1\"] selectors to stable ones", () => {
  const { doc, win } = makeDoc("<body><p id='a'>oi</p></body>");
  const session = makeSession(doc, win);
  const a = doc.getElementById("a");
  session.selectOnly(a);

  const ops = [{ op: "setStyle", selector: '[data-aise-id="s1"]', name: "color", value: "red", position: "" }];
  session.addRequest({ request: "req", summary: "sum", ops });

  const collected = session.collectPresetOps();
  assert.equal(collected.length, 1);
  assert.equal(collected[0].selector, "#a");
});

test("applyPreset counts applied vs missing when a selector matches nothing", () => {
  const { doc, win } = makeDoc("<body><p id='a'>oi</p></body>");
  const session = makeSession(doc, win);

  const preset = {
    id: "preset-1",
    name: "Meu preset",
    ops: [
      { op: "setStyle", selector: "#a", name: "color", value: "red", position: "" },
      { op: "setStyle", selector: "#does-not-exist", name: "color", value: "blue", position: "" },
    ],
  };

  const result = session.applyPreset(preset);
  assert.equal(result.applied, 1);
  assert.equal(result.total, 2);
  assert.deepEqual(result.missing, ["#does-not-exist"]);
  assert.equal(doc.getElementById("a").style.color, "red");
  assert.equal(session.activeCount(), 2);

  const state = session.publicState({});
  assert.deepEqual(state.presetsApplied, [{ id: "preset-1", name: "Meu preset", applied: 1, total: 2 }]);
  assert.equal(state.fromPreset, true);

  assert.deepEqual(session.disableAutoIds(), ["preset-1"]);
});
