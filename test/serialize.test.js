import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { tagSelection, clearTags, serializeElement, ancestorChain, buildSelectionContext } from "../lib/serialize.js";
import { stableSelector, shortLabel } from "../lib/selector.js";

test("tagSelection numera e clearTags limpa", () => {
  const { doc } = makeDoc("<body><p></p><b></b></body>");
  const ids = tagSelection([doc.querySelector("p"), doc.querySelector("b")]);
  assert.deepEqual(ids, ["s1", "s2"]);
  assert.equal(doc.querySelector("b").dataset.aiseId, "s2");
  clearTags(doc);
  assert.equal(doc.querySelectorAll("[data-aise-id]").length, 0);
});
test("serializeElement colapsa além da profundidade e corta tamanho", () => {
  const { doc } = makeDoc("<body><div id='a'><ul><li><span><i>fundo</i></span></li></ul></div></body>");
  const s = serializeElement(doc.getElementById("a"), { maxDepth: 2, maxChars: 4000 });
  assert.ok(s.includes("<li"));
  assert.ok(!s.includes("<i>"));
  assert.ok(s.includes("…"));
  const big = serializeElement(doc.getElementById("a"), { maxDepth: 9, maxChars: 20 });
  assert.ok(big.length <= 20 + 10);
});
test("ancestorChain limita níveis", () => {
  const { doc } = makeDoc("<body><div id='app'><nav class='menu'><a>1</a></nav></div></body>");
  assert.equal(ancestorChain(doc.querySelector("a"), 5), "body > div#app > nav.menu");
  assert.equal(ancestorChain(doc.querySelector("a"), 1), "nav.menu");
});
test("buildSelectionContext junta tudo", () => {
  const { doc, win } = makeDoc("<body><div id='app'><button class='x'>ok</button></div></body>");
  const btn = doc.querySelector("button");
  tagSelection([btn]);
  const [ctx] = buildSelectionContext([btn], { win, stableSelector, shortLabel });
  assert.equal(ctx.id, "s1");
  assert.equal(ctx.tag, "button");
  assert.equal(ctx.selector, "button.x");
  assert.equal(ctx.label, "button.x");
  assert.equal(ctx.ancestors, "body > div#app");
  assert.ok(ctx.html.includes('data-aise-id="s1"'));
  assert.ok("display" in ctx.styles);
});
