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
  // `activeCount` soma o que de fato mudou na página (`applied`), não `total`:
  // a op cujo seletor não casou não é uma alteração.
  assert.equal(session.activeCount(), 1);

  const state = session.publicState({});
  assert.deepEqual(state.presetsApplied, [{ id: "preset-1", name: "Meu preset", applied: 1, total: 2 }]);
  assert.equal(state.fromPreset, true);

  assert.deepEqual(session.disableAutoIds(), ["preset-1"]);
});

test("desfazer tudo com edições sobrepostas volta ao valor original, não ao da primeira edição", () => {
  const { doc, win } = makeDoc("<body><p id='a' style='color: black'>oi</p></body>");
  const session = makeSession(doc, win);
  const a = doc.getElementById("a");

  session.selectOnly(a);
  const e1 = session.addRequest({
    request: "1",
    summary: "s1",
    ops: [{ op: "setStyle", selector: "#a", name: "color", value: "red", position: "" }],
  });
  session.selectOnly(a);
  const e2 = session.addRequest({
    request: "2",
    summary: "s2",
    ops: [{ op: "setStyle", selector: "#a", name: "color", value: "blue", position: "" }],
  });
  assert.equal(a.style.color, "blue");

  // do mais novo para o mais antigo
  session.undoRequest(e2.id);
  session.undoRequest(e1.id);
  assert.equal(a.style.color, "black", "volta ao valor original da página");
});

test("toggleOriginal com dois pedidos sobrepostos no mesmo elemento volta ao original e depois ao último valor", () => {
  const { doc, win } = makeDoc("<body><p id='a' style='color: black'>oi</p></body>");
  const session = makeSession(doc, win);
  const a = doc.getElementById("a");

  session.selectOnly(a);
  session.addRequest({
    request: "1",
    summary: "s1",
    ops: [{ op: "setStyle", selector: "#a", name: "color", value: "red", position: "" }],
  });
  session.selectOnly(a);
  session.addRequest({
    request: "2",
    summary: "s2",
    ops: [{ op: "setStyle", selector: "#a", name: "color", value: "blue", position: "" }],
  });
  assert.equal(a.style.color, "blue");

  session.toggleOriginal();
  assert.equal(a.style.color, "black", "modo original mostra o estilo inicial, não o da primeira edição");

  session.toggleOriginal();
  assert.equal(a.style.color, "blue", "ao voltar, vale a edição mais recente");
});

test("redo reaplica os seletores estáveis do pedido, não o marcador [data-aise-id] reciclado", () => {
  const { doc, win } = makeDoc("<body><p id='a'>a</p><p id='b'>b</p></body>");
  const session = makeSession(doc, win);
  const a = doc.getElementById("a");
  const b = doc.getElementById("b");

  session.selectOnly(a);
  const entry = session.addRequest({
    request: "vermelho",
    summary: "s",
    ops: [{ op: "setStyle", selector: '[data-aise-id="s1"]', name: "color", value: "red", position: "" }],
  });
  assert.equal(a.style.color, "red");

  session.undoRequest(entry.id);
  assert.equal(a.style.color, "");

  // B recebe o mesmo marcador que A tinha
  session.selectOnly(b);
  assert.equal(b.getAttribute("data-aise-id"), "s1");

  session.redoRequest(entry.id);
  assert.equal(a.style.color, "red", "o redo acerta A");
  assert.equal(b.style.color, "", "e não vaza para B");
});

test("redo cujo seletor não casa mais marca a entrada como desfeita e avisa", () => {
  const { doc, win } = makeDoc("<body><p id='a'>a</p></body>");
  const warnings = [];
  const session = createSession({
    doc,
    win,
    applyOps,
    undoRecords,
    redoRecords,
    stabilizeOps,
    sanitize: (html) => sanitizeHTML(html, doc),
    warn: (msg) => warnings.push(msg),
  });
  const a = doc.getElementById("a");
  session.selectOnly(a);
  const entry = session.addRequest({
    request: "vermelho",
    summary: "s",
    ops: [{ op: "setStyle", selector: "#a", name: "color", value: "red", position: "" }],
  });
  session.undoRequest(entry.id);
  session.clear();
  a.remove();

  assert.equal(session.redoRequest(entry.id), false);
  assert.equal(session.activeCount(), 0, "entrada que não casou não conta como ativa");
  assert.equal(session.publicState({}).history[0].undone, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /nenhum elemento correspondeu/);
});

test("applyPreset do mesmo preset duas vezes não empilha: um item em presetsApplied e activeCount não dobra", () => {
  const { doc, win } = makeDoc("<body><p id='a'>oi</p></body>");
  const session = makeSession(doc, win);
  const preset = {
    id: "preset-1",
    name: "Meu preset",
    ops: [{ op: "setStyle", selector: "#a", name: "color", value: "red", position: "" }],
  };

  session.applyPreset(preset);
  session.applyPreset(preset);

  const state = session.publicState({});
  assert.equal(state.presetsApplied.length, 1);
  assert.equal(state.activeCount, 1);
  assert.equal(doc.getElementById("a").style.color, "red");
});

test("reaplicar um preset editado reflete a versão nova, não a antiga", () => {
  const { doc, win } = makeDoc("<body><p id='a'>oi</p></body>");
  const session = makeSession(doc, win);

  session.applyPreset({
    id: "preset-1",
    name: "Meu preset",
    ops: [{ op: "setStyle", selector: "#a", name: "color", value: "red", position: "" }],
  });
  session.applyPreset({
    id: "preset-1",
    name: "Meu preset",
    ops: [{ op: "setStyle", selector: "#a", name: "color", value: "green", position: "" }],
  });

  assert.equal(doc.getElementById("a").style.color, "green");
  assert.equal(session.publicState({}).presetsApplied.length, 1);
});

test("autoApplied só é verdadeiro quando um preset veio do auto-aplicar", () => {
  const { doc, win } = makeDoc("<body><p id='a'>oi</p></body>");
  const session = makeSession(doc, win);
  const preset = {
    id: "preset-1",
    name: "Meu preset",
    ops: [{ op: "setStyle", selector: "#a", name: "color", value: "red", position: "" }],
  };

  session.applyPreset(preset);
  let state = session.publicState({});
  assert.equal(state.fromPreset, true);
  assert.equal(state.autoApplied, false, "aplicado à mão pelo popup");

  session.applyPreset({ ...preset, id: "preset-2" }, { auto: true });
  state = session.publicState({});
  assert.equal(state.autoApplied, true);
});

test("applyPreset no modo original é recusado: não escreve no DOM nem em presetsApplied", () => {
  const { doc, win } = makeDoc("<body><p id='a'>a</p></body>");
  const session = makeSession(doc, win);
  const a = doc.getElementById("a");

  session.toggleOriginal();
  assert.equal(session.publicState().originalMode, true);

  const preset = {
    id: "p1",
    name: "Menu",
    ops: [
      { op: "setStyle", selector: "#a", name: "color", value: "red", position: "" },
      { op: "setStyle", selector: "#a", name: "margin", value: "0", position: "" },
    ],
  };
  const res = session.applyPreset(preset);
  assert.deepEqual(res, { applied: 0, total: 2, missing: [] });
  assert.equal(a.style.color, "", "o DOM revertido continua revertido");
  assert.equal(session.publicState().presetsApplied.length, 0);

  // saindo do modo original, o preset recusado não ressuscita
  session.toggleOriginal();
  assert.equal(a.style.color, "");
  assert.equal(session.activeCount(), 0);
});
