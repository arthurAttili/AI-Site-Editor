import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { tagSelection, clearTags, serializeElement, ancestorChain, buildSelectionContext, serializeOutline } from "../lib/serialize.js";
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

test("serializeOutline: uma linha por elemento, texto próprio, marcador [sN], dicas de atributo e nth-of-type só quando ambíguo", () => {
  const { doc } = makeDoc(`<body class="home"><script>x()</script><style>p{}</style><aise-panel><div>painel</div></aise-panel>
    <main><section class="hero"><h1 id="t">Bem-vindo   ao site</h1><p>Um</p><p>Dois</p><a href="/planos">Ver planos</a></section>
    <section class="planos"><img alt="Foto"><ul><li class="item">a</li><li class="item">b</li></ul><svg><path d="M0"/></svg></section></main></body>`);
  tagSelection([doc.querySelector("a")]);
  const out = serializeOutline(doc);
  const lines = out.split("\n");
  assert.equal(lines[0], "body.home");
  assert.equal(lines[1], "  main");
  assert.equal(lines[2], "    section.hero");
  assert.equal(lines[3], '      h1#t "Bem-vindo ao site"');
  assert.equal(lines[4], '      p:nth-of-type(1) "Um"');
  assert.equal(lines[5], '      p:nth-of-type(2) "Dois"');
  assert.equal(lines[6], '      a [href="/planos"] "Ver planos" [s1]');
  assert.equal(lines[7], "    section.planos");
  assert.equal(lines[8], '      img [alt="Foto"]');
  assert.equal(lines[9], "      ul");
  assert.equal(lines[10], '        li.item:nth-of-type(1) "a"');
  assert.equal(lines[11], '        li.item:nth-of-type(2) "b"');
  assert.equal(lines[12], "      svg");
  assert.equal(lines.length, 13, "script/style/aise-* e o interior do svg ficam de fora");
});

test("serializeOutline: limita filhos e profundidade, mas sempre desce até o elemento selecionado; corta pelo tamanho", () => {
  const items = Array.from({ length: 20 }, (_, i) => `<li>item ${i}</li>`).join("");
  const { doc } = makeDoc(`<body><ul>${items}</ul><div><div><div><div><span id="deep">fundo</span><b>x</b></div></div></div></div></body>`);
  tagSelection([doc.getElementById("deep")]);
  const out = serializeOutline(doc, { maxChildren: 3, maxDepth: 2 });
  assert.match(out, /\n    li:nth-of-type\(3\) "item 2"\n    … \+17 elemento\(s\) omitido\(s\)\n/);
  assert.ok(!out.includes("item 3"));
  assert.match(out, /\n  div\n    div\n      div\n        div\n          span#deep "fundo" \[s1\]\n          … \+1 elemento\(s\) omitido\(s\)/, "caminho até o selecionado aparece mesmo além de maxDepth; o irmão não");
  const small = serializeOutline(doc, { maxChars: 30 });
  assert.ok(small.endsWith("…[cortado]"));
  assert.ok(small.length <= 30 + "\n…[cortado]".length);
  assert.equal(serializeOutline({ body: null }), "");
});
