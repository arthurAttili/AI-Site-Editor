import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { createPicker } from "../lib/ui/picker.js";

function setup() {
  const { doc, win } = makeDoc("<body><button id='go' class='cta big wide'>Ir</button><aise-panel><textarea></textarea></aise-panel></body>");
  const calls = [];
  const picker = createPicker(doc, {
    onPick: (el, meta) => calls.push(["pick", el.id, meta.additive]),
    onCancel: () => calls.push(["cancel"]),
  });
  return { doc, win, picker, calls };
}

test("start cria o host <aise-picker>, marca o documento e stop desfaz tudo", () => {
  const { doc, picker } = setup();
  assert.equal(picker.isActive(), false);
  picker.start();
  picker.start(); // idempotente
  assert.equal(picker.isActive(), true);
  assert.equal(doc.querySelectorAll("aise-picker").length, 1);
  assert.ok(doc.documentElement.hasAttribute("data-aise-picking"));
  assert.match(doc.querySelector("style[data-aise-picker-cursor]").textContent, /cursor: crosshair !important/);
  picker.stop();
  assert.equal(doc.querySelector("style[data-aise-picker-cursor]"), null);
  assert.equal(picker.isActive(), false);
  assert.equal(doc.documentElement.hasAttribute("data-aise-picking"), false);
  assert.equal(doc.querySelector("aise-picker").hidden, true);
});

test("mover o mouse sobre um elemento mostra a caixa com rótulo tag#id.classes", () => {
  const { doc, win, picker } = setup();
  picker.start();
  const btn = doc.getElementById("go");
  btn.dispatchEvent(new win.MouseEvent("mousemove", { bubbles: true }));
  const root = doc.querySelector("aise-picker").shadowRoot;
  const label = root.querySelector('[data-role="label"]');
  assert.equal(label.hidden, false);
  assert.match(label.textContent, /^button#go\.cta\.big/);
  assert.equal(root.querySelector('[data-role="box"]').hidden, false);
});

test("clique simples entrega o elemento, impede o padrão e desliga o picker", () => {
  const { doc, win, picker, calls } = setup();
  picker.start();
  const btn = doc.getElementById("go");
  let reached = false;
  btn.addEventListener("click", () => { reached = true; });
  const ev = new win.MouseEvent("click", { bubbles: true, cancelable: true });
  btn.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(reached, false, "o clique não chega ao site");
  assert.deepEqual(calls, [["pick", "go", false]]);
  assert.equal(picker.isActive(), false);
});

test("Shift+clique entrega como aditivo e mantém o picker ligado", () => {
  const { doc, win, picker, calls } = setup();
  picker.start();
  doc.getElementById("go").dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
  assert.deepEqual(calls, [["pick", "go", true]]);
  assert.equal(picker.isActive(), true);
});

test("Esc cancela: chama onCancel e desliga", () => {
  const { doc, win, picker, calls } = setup();
  picker.start();
  doc.body.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.deepEqual(calls, [["cancel"]]);
  assert.equal(picker.isActive(), false);
});

test("cliques dentro da UI da extensão passam intactos", () => {
  const { doc, win, picker, calls } = setup();
  picker.start();
  const ta = doc.querySelector("aise-panel textarea");
  const ev = new win.MouseEvent("click", { bubbles: true, cancelable: true });
  ta.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
  assert.deepEqual(calls, []);
  assert.equal(picker.isActive(), true);
});

test("depois de stop, cliques voltam a chegar ao site normalmente", () => {
  const { doc, win, picker, calls } = setup();
  picker.start();
  picker.stop();
  const ev = new win.MouseEvent("click", { bubbles: true, cancelable: true });
  doc.getElementById("go").dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
  assert.deepEqual(calls, []);
});
