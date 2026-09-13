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

test("setStyle com !important aplica e desfaz", () => {
  const { doc } = makeDoc("<body><p id='a' style='color: blue'>oi</p></body>");
  const el = doc.getElementById("a");
  const r = applyOp({ op: "setStyle", selector: "#a", name: "color", value: "red !important", position: "" }, doc);
  assert.equal(el.style.getPropertyValue("color"), "red");
  assert.equal(el.style.getPropertyPriority("color"), "important");
  assert.equal(r.changes[0].after, "red !important");
  r.undo();
  assert.equal(el.style.color, "blue");
  assert.equal(el.style.getPropertyPriority("color"), "");
});

test("remove desfeito fora de ordem não lança e restaura o nó", () => {
  const { doc } = makeDoc("<body><ul id='l'><li id='a'>1</li><li id='b'>2</li><li id='c'>3</li></ul></body>");
  const rb = applyOp({ op: "remove", selector: "#b", name: "", value: "", position: "" }, doc);
  const rc = applyOp({ op: "remove", selector: "#c", name: "", value: "", position: "" }, doc);
  // Desfaz fora de ordem: primeiro o mais antigo (b), cujo "next" original (c) já foi removido do DOM.
  assert.doesNotThrow(() => rb.undo());
  assert.equal(doc.getElementById("b").parentNode, doc.getElementById("l"));
  assert.doesNotThrow(() => rc.undo());
  assert.equal(doc.getElementById("c").parentNode, doc.getElementById("l"));
});

test("insertHTML com position inválida retorna warning sem lançar", () => {
  const { doc } = makeDoc("<body><p id='a'>oi</p></body>");
  const r = applyOp({ op: "insertHTML", selector: "#a", name: "", value: "<b>x</b>", position: "dentro" }, doc);
  assert.equal(r.matched, 0);
  assert.deepEqual(r.changes, []);
  assert.match(r.warning, /inválida/);
});

test("queryNodes descarta os hosts da extensão: remove aise-indicator não casa nada", () => {
  const { doc } = makeDoc("<body><p id='a'>a</p></body>");
  doc.documentElement.appendChild(doc.createElement("aise-indicator"));
  doc.documentElement.appendChild(doc.createElement("aise-panel"));

  const rec = applyOp({ op: "remove", selector: "aise-indicator", name: "", value: "", position: "" }, doc, {});
  assert.equal(rec.matched, 0);
  assert.ok(doc.querySelector("aise-indicator"));

  const rec2 = applyOp({ op: "setStyle", selector: "aise-panel", name: "display", value: "none", position: "" }, doc, {});
  assert.equal(rec2.matched, 0);
  assert.equal(doc.querySelector("aise-panel").style.display, "");
});

test("queryNodes também descarta descendentes de um host aise-*", () => {
  const { doc } = makeDoc("<body><p id='a'>a</p></body>");
  const host = doc.createElement("aise-indicator");
  const inner = doc.createElement("p");
  host.appendChild(inner);
  doc.documentElement.appendChild(host);

  const rec = applyOp({ op: "setStyle", selector: "p", name: "color", value: "red", position: "" }, doc, {});
  assert.equal(rec.matched, 1, "só o <p> da página, não o de dentro do host");
  assert.equal(doc.getElementById("a").style.color, "red");
  assert.equal(inner.style.color, "");
});

test("injectCSS que cita aise- é recusado; o marcador [data-aise-id] continua valendo", () => {
  const { doc } = makeDoc("<body><p id='a'>a</p></body>");

  const rec = applyOp({ op: "injectCSS", selector: "", name: "", value: "aise-indicator{display:none}", position: "" }, doc, {});
  assert.equal(rec.matched, 0);
  assert.match(rec.warning, /bloqueado por segurança/);
  assert.equal(doc.querySelector("style[data-aise]"), null);

  const rec2 = applyOp(
    { op: "injectCSS", selector: "", name: "", value: '[data-aise-id="s1"]{color:red}', position: "" },
    doc,
    {}
  );
  assert.equal(rec2.matched, 1);

  const rec3 = applyOp(
    { op: "injectCSS", selector: "", name: "", value: '[data-aise-id="s1"], aise-indicator{display:none}', position: "" },
    doc,
    {}
  );
  assert.equal(rec3.matched, 0);
});

test("setAttr recusa on*, href javascript: e srcdoc", () => {
  const { doc } = makeDoc("<body><a id='a' href='https://ok.example/'>a</a></body>");
  const a = doc.getElementById("a");

  const rec = applyOp({ op: "setAttr", selector: "#a", name: "onclick", value: "alert(1)", position: "" }, doc, {});
  assert.equal(rec.matched, 0);
  assert.equal(rec.warning, "atributo bloqueado por segurança: onclick");
  assert.equal(a.hasAttribute("onclick"), false);

  const rec2 = applyOp({ op: "setAttr", selector: "#a", name: "href", value: "javascript:alert(1)", position: "" }, doc, {});
  assert.equal(rec2.matched, 0);
  assert.equal(a.getAttribute("href"), "https://ok.example/");

  const rec3 = applyOp({ op: "setAttr", selector: "#a", name: "srcdoc", value: "<b>x</b>", position: "" }, doc, {});
  assert.equal(rec3.matched, 0);

  const rec4 = applyOp({ op: "setAttr", selector: "#a", name: "title", value: "ok", position: "" }, doc, {});
  assert.equal(rec4.matched, 1);
  assert.equal(a.getAttribute("title"), "ok");
});

test("setAttr style perigoso e setStyle com expression() são recusados", () => {
  const { doc } = makeDoc("<body><p id='a'>a</p></body>");
  const a = doc.getElementById("a");

  const rec = applyOp({ op: "setAttr", selector: "#a", name: "style", value: "width:expression(alert(1))", position: "" }, doc, {});
  assert.equal(rec.matched, 0);

  const rec2 = applyOp({ op: "setStyle", selector: "#a", name: "background", value: "url(javascript:alert(1))", position: "" }, doc, {});
  assert.equal(rec2.matched, 0);
  assert.equal(rec2.warning, "estilo bloqueado por segurança: background");
  assert.equal(a.style.background, "");

  const rec3 = applyOp({ op: "setStyle", selector: "#a", name: "color", value: "red", position: "" }, doc, {});
  assert.equal(rec3.matched, 1);
  assert.equal(a.style.color, "red");
});

test("injectCSS aceita classe do site que só contém 'aise-' no meio, como .praise-box", () => {
  const { doc } = makeDoc("<body><p class='praise-box'>a</p></body>");

  const ok = applyOp({ op: "injectCSS", selector: "", name: "", value: ".praise-box{color:red}", position: "" }, doc, {});
  assert.equal(ok.matched, 1, ".praise-box não é referência à extensão");
  assert.equal(ok.warning, undefined);

  const ok2 = applyOp({ op: "injectCSS", selector: "", name: "", value: "#malaise-banner,.turquoise-bg{margin:0}", position: "" }, doc, {});
  assert.equal(ok2.matched, 1);

  // a borda de identificador continua pegando as formas que importam
  for (const value of [
    "aise-indicator{display:none}",
    ".x, aise-panel{display:none}",
    "body > aise-indicator{opacity:0}",
    '[data-aise-id="s1"], aise-indicator{display:none}',
  ]) {
    const rec = applyOp({ op: "injectCSS", selector: "", name: "", value, position: "" }, doc, {});
    assert.equal(rec.matched, 0, `deveria recusar: ${value}`);
    assert.match(rec.warning, /bloqueado por segurança/);
  }
});
