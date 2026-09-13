import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { validateOps, applyOp, applyOps, undoRecords } from "../lib/ops.js";

test("validateOps normaliza e descarta inválidos", () => {
  const { ops, errors } = validateOps({ ops: [
    { op: "setStyle", selector: "p", name: "color", value: "red" },
    { op: "voar", selector: "p" },
    { op: "insertHTML", selector: "p", value: "<b>x</b>", position: "dentro" },
  ]});
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0], { op: "setStyle", selector: "p", name: "color", value: "red", position: "" });
  assert.equal(errors.length, 2);
});

test("setStyle aplica e desfaz", () => {
  const { doc } = makeDoc("<body><p id='a' style='color: blue'>oi</p></body>");
  const r = applyOp({ op: "setStyle", selector: "#a", name: "color", value: "red", position: "" }, doc);
  assert.equal(r.matched, 1);
  assert.equal(doc.getElementById("a").style.color, "red");
  assert.deepEqual(r.changes[0], { target: "#a", before: "blue", after: "red" });
  r.undo();
  assert.equal(doc.getElementById("a").style.color, "blue");
});

test("setAttr/removeAttr/addClass/removeClass/setText/setHTML desfazem", () => {
  const { doc } = makeDoc("<body><a id='a' href='/x' class='k'>oi</a></body>");
  const a = doc.getElementById("a");
  const recs = applyOps([
    { op: "setAttr", selector: "#a", name: "href", value: "/y", position: "" },
    { op: "addClass", selector: "#a", name: "", value: "z", position: "" },
    { op: "removeClass", selector: "#a", name: "", value: "k", position: "" },
    { op: "setText", selector: "#a", name: "", value: "tchau", position: "" },
    { op: "removeAttr", selector: "#a", name: "href", value: "", position: "" },
  ], doc);
  assert.equal(a.getAttribute("href"), null);
  assert.equal(a.className, "z");
  assert.equal(a.textContent, "tchau");
  undoRecords(recs);
  assert.equal(a.getAttribute("href"), "/x");
  assert.equal(a.className, "k");
  assert.equal(a.textContent, "oi");
});

test("setHTML sanitiza e desfaz", () => {
  const { doc } = makeDoc("<body><div id='a'><i>a</i></div></body>");
  const r = applyOp({ op: "setHTML", selector: "#a", name: "", value: "<b>b</b><script>1</script>", position: "" }, doc,
    { sanitize: (h) => h.replace(/<script[\s\S]*?<\/script>/g, "") });
  assert.equal(doc.getElementById("a").innerHTML, "<b>b</b>");
  r.undo();
  assert.equal(doc.getElementById("a").innerHTML, "<i>a</i>");
});

test("insertHTML e remove desfazem preservando posição", () => {
  const { doc } = makeDoc("<body><ul id='l'><li id='a'>1</li><li id='b'>2</li></ul></body>");
  const r1 = applyOp({ op: "insertHTML", selector: "#a", name: "", value: "<li id='n'>novo</li>", position: "afterend" }, doc);
  assert.equal(doc.querySelector("#l").children[1].id, "n");
  const r2 = applyOp({ op: "remove", selector: "#a", name: "", value: "", position: "" }, doc);
  assert.equal(doc.getElementById("a"), null);
  undoRecords([r1, r2]);
  assert.deepEqual([...doc.querySelector("#l").children].map(e => e.id), ["a", "b"]);
});

test("injectCSS cria <style data-aise> no head e desfaz", () => {
  const { doc } = makeDoc("<head></head><body></body>");
  const r = applyOp({ op: "injectCSS", selector: "", name: "", value: "p{color:red}", position: "" }, doc);
  assert.equal(doc.head.querySelectorAll("style[data-aise]").length, 1);
  r.undo();
  assert.equal(doc.head.querySelectorAll("style[data-aise]").length, 0);
});

test("seletor sem match gera warning e matched 0", () => {
  const { doc } = makeDoc("<body></body>");
  const r = applyOp({ op: "setText", selector: ".nada", name: "", value: "x", position: "" }, doc);
  assert.equal(r.matched, 0);
  assert.match(r.warning, /não encontrou/);
});

test("seletor inválido não lança", () => {
  const { doc } = makeDoc("<body></body>");
  const r = applyOp({ op: "setText", selector: "p[", name: "", value: "x", position: "" }, doc);
  assert.equal(r.matched, 0);
  assert.match(r.warning, /inválido/);
});
