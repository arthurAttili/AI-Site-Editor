import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { stableSelector, shortLabel } from "../lib/selector.js";

const html = `<body><div id="app"><nav class="menu"><a class="item">1</a><a class="item">2</a></nav>
<main><button class="btn primary">ok</button><button class="btn">x</button></main></div></body>`;

test("id único vira #id", () => {
  const { doc } = makeDoc(html);
  assert.equal(stableSelector(doc.getElementById("app")), "#app");
});
test("classes únicas viram tag.classe", () => {
  const { doc } = makeDoc(html);
  assert.equal(stableSelector(doc.querySelector(".primary")), "button.btn.primary");
});
test("ambíguo vira caminho com nth-of-type a partir do id mais próximo", () => {
  const { doc } = makeDoc(html);
  const sel = stableSelector(doc.querySelectorAll(".item")[1]);
  assert.equal(doc.querySelector(sel), doc.querySelectorAll(".item")[1]);
  assert.match(sel, /^#app > nav/);
  assert.match(sel, /a:nth-of-type\(2\)$/);
});
test("ignora data-aise-* e classes vazias", () => {
  const { doc } = makeDoc(`<body><p data-aise-id="s1" class="">x</p><p>y</p></body>`);
  const sel = stableSelector(doc.querySelector("p"));
  assert.ok(!sel.includes("aise"));
  assert.equal(doc.querySelector(sel).textContent, "x");
});
test("shortLabel", () => {
  const { doc } = makeDoc(html);
  assert.equal(shortLabel(doc.getElementById("app")), "div#app");
  assert.equal(shortLabel(doc.querySelector(".primary")), "button.btn.primary");
  assert.equal(shortLabel(doc.querySelector("main")), "main");
});
