import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, buildPresetReport, formatDate, CONTEXT_TEXT } from "../lib/report.js";

const target = {
  id: "s1",
  label: "button#cta.btn",
  selector: "#cta",
  ancestors: "body > main > section.hero",
  htmlBefore: '<button id="cta" class="btn">Comprar</button>',
  htmlAfter: '<button id="cta" class="btn" style="background-color: red;">Comprar agora</button>',
};

function entry(overrides = {}) {
  return {
    n: 1,
    request: "deixe o botão vermelho e maior",
    summary: "Fundo vermelho e texto novo no botão.",
    undone: false,
    targets: [target],
    records: [
      { op: { op: "setStyle", selector: "#cta", name: "background-color", value: "red" }, matched: 1, warning: null, changes: [{ before: "", after: "red" }] },
      { op: { op: "setText", selector: "#cta", value: "Comprar agora" }, matched: 1, warning: null, changes: [{ before: "Comprar", after: "Comprar agora" }] },
      { op: { op: "setAttr", selector: "#cta", name: "onclick", value: "x()" }, matched: 0, warning: "atributo bloqueado por segurança: onclick", changes: [] },
    ],
    ...overrides,
  };
}

test("buildReport: cabeçalho, contexto, pedido com alvo, operações e aviso", () => {
  const md = buildReport({
    origin: "https://site.com",
    url: "https://site.com/home?x=1",
    title: "Home — Site",
    generatedAt: new Date(2026, 8, 13, 9, 5),
    history: [entry()],
  });
  assert.ok(md.startsWith("# Ajustes solicitados — Home — Site\n"));
  assert.match(md, /- Site: https:\/\/site\.com\n/);
  assert.match(md, /- Página: https:\/\/site\.com\/home\?x=1\n/);
  assert.match(md, /- Gerado em: 2026-09-13 09:05\n/);
  assert.match(md, /- Pedidos a aplicar: 1\n/);
  assert.ok(md.includes(CONTEXT_TEXT.trim()), "traz as instruções para quem for aplicar");
  assert.match(md, /## Pedido 1 — «deixe o botão vermelho e maior»/);
  assert.match(md, /\*\*Como foi resolvido:\*\* Fundo vermelho e texto novo no botão\./);
  assert.match(md, /\*\*Elemento s1\*\* — `button#cta\.btn` — seletor: `#cta`/);
  assert.match(md, /Caminho: `body > main > section\.hero`/);
  assert.match(md, /HTML antes:\n```html\n<button id="cta" class="btn">Comprar<\/button>\n```/);
  assert.match(md, /HTML depois:\n```html\n<button id="cta" class="btn" style="background-color: red;">Comprar agora<\/button>\n```/);
  assert.match(md, /- setStyle em `#cta`: `background-color` "" → "red"/);
  assert.match(md, /- setText em `#cta`: "Comprar" → "Comprar agora"/);
  assert.match(md, /- ⚠ setAttr em `#cta` — não aplicada: atributo bloqueado por segurança: onclick/);
  assert.ok(md.endsWith("\n") && !md.endsWith("\n\n"));
});

test("buildReport: pedidos desfeitos ficam de fora e são contados; ops de bloco viram fences", () => {
  const md = buildReport({
    origin: "https://site.com",
    url: "https://site.com/",
    title: "",
    history: [
      entry({ n: 1, undone: true, request: "pedido desfeito" }),
      entry({
        n: 2,
        request: "troque o bloco",
        summary: "",
        targets: [{ ...target, htmlAfter: target.htmlBefore }],
        records: [
          { op: { op: "setHTML", selector: "#a", value: "<b>x</b>" }, matched: 1, warning: null, changes: [{ before: "<i>y</i>", after: "<b>x</b>" }] },
          { op: { op: "insertHTML", selector: "#a", position: "afterend", value: "<p>novo</p>" }, matched: 1, warning: null, changes: [{ before: "", after: "<p>novo</p>" }] },
          { op: { op: "remove", selector: "#old" }, matched: 1, warning: null, changes: [{ before: "<div id=\"old\"></div>", after: "" }] },
          { op: { op: "injectCSS", selector: "", value: ".x{color:red}" }, matched: 1, warning: null, changes: [] },
          { op: { op: "addClass", selector: "#a", value: "big" }, matched: 1, warning: null, changes: [{ before: "btn", after: "btn big" }] },
        ],
      }),
    ],
  });
  assert.match(md, /^# Ajustes solicitados — https:\/\/site\.com\n/);
  assert.match(md, /- Pedidos a aplicar: 1 \(1 desfeito\(s\), omitido\(s\)\)/);
  assert.ok(!md.includes("pedido desfeito"));
  assert.ok(!md.includes("Como foi resolvido"), "sem resumo, sem linha de resumo");
  assert.ok(!md.includes("HTML depois"), "HTML depois igual ao de antes não repete");
  assert.match(md, /- setHTML em `#a` — conteúdo antes:\n```html\n<i>y<\/i>\n```\n  conteúdo depois:\n```html\n<b>x<\/b>\n```/);
  assert.match(md, /- insertHTML \(afterend\) em `#a` — HTML inserido:\n```html\n<p>novo<\/p>\n```/);
  assert.match(md, /- remove `#old` — elemento removido:\n```html\n<div id="old"><\/div>\n```/);
  assert.match(md, /- injectCSS — CSS adicionado à página:\n```css\n\.x\{color:red\}\n```/);
  assert.match(md, /- addClass "big" em `#a` \(class: "btn" → "btn big"\)/);
});

test("buildReport: valores longos são cortados e presets aplicados entram numa seção própria", () => {
  const longText = "x".repeat(400);
  const longHtml = "<p>" + "y".repeat(2000) + "</p>";
  const md = buildReport({
    origin: "https://site.com",
    url: "https://site.com/",
    history: [
      entry({
        targets: [{ ...target, htmlBefore: longHtml, htmlAfter: longHtml }],
        records: [{ op: { op: "setText", selector: "#a", value: longText }, matched: 1, warning: null, changes: [{ before: "a\n b", after: longText }] }],
      }),
    ],
    presets: [
      { name: "Home azul", applied: 1, total: 2, records: [
        { op: { op: "setStyle", selector: "h1", name: "color", value: "blue" }, matched: 1, warning: null, changes: [{ before: "", after: "blue" }] },
        { op: { op: "setStyle", selector: "#sumiu", name: "color", value: "blue" }, matched: 0, warning: 'seletor "#sumiu" não encontrou elementos', changes: [] },
      ] },
      { name: "Nada casou", applied: 0, total: 1, records: [{ op: { op: "remove", selector: "#z" }, matched: 0, warning: "seletor não encontrou", changes: [] }] },
    ],
  });
  assert.match(md, /"a b" → "x{300}…\[cortado\]"/, "inline: espaços colapsados e corte em 300");
  assert.match(md, /```html\n<p>y{1497}…\[cortado\]\n```/, "bloco: corte em 1500");
  assert.match(md, /## Presets já aplicados nesta página/);
  assert.match(md, /### Preset «Home azul» \(1\/2 operações aplicadas\)\n- setStyle em `h1`: `color` "" → "blue"\n- ⚠ setStyle em `#sumiu` — não aplicada: seletor "#sumiu" não encontrou elementos/);
  assert.ok(!md.includes("Nada casou"), "preset sem nenhuma op aplicada não entra");
});

test("buildReport sem pedidos e formatDate inválido", () => {
  const md = buildReport({ origin: "https://a.b", url: "https://a.b/", history: [] });
  assert.match(md, /- Pedidos a aplicar: 0\n/);
  assert.match(md, /_Nenhum pedido ativo nesta sessão\._/);
  assert.ok(!md.includes("Gerado em"));
  assert.equal(formatDate(new Date("nope")), "");
  assert.equal(formatDate("2026-01-01"), "");
});

test("buildReport: setStyle mostra o valor pedido quando o DOM devolve o valor normalizado", () => {
  const md = buildReport({
    origin: "https://site.com",
    url: "https://site.com/",
    history: [entry({ targets: [], records: [
      { op: { op: "setStyle", selector: "#cta", name: "background-color", value: "#d32f2f" }, matched: 1, warning: null, changes: [{ before: "", after: "rgb(211, 47, 47)" }] },
      { op: { op: "setStyle", selector: "#cta", name: "color", value: "red" }, matched: 1, warning: null, changes: [{ before: "", after: "red" }] },
    ] })],
  });
  assert.match(md, /- setStyle em `#cta`: `background-color` "" → "rgb\(211, 47, 47\)" \(valor pedido: "#d32f2f"\)/);
  assert.match(md, /- setStyle em `#cta`: `color` "" → "red"\n/, "valor igual não repete");
});

test("buildPresetReport: usa o histórico guardado no preset (ignorando desfeitos) e cai nas ops quando não há histórico", () => {
  const withHistory = buildPresetReport({
    name: "Home azul", url: "https://site.com/home", title: "Home — Site",
    ops: [{ op: "setStyle", selector: "#cta", name: "color", value: "blue" }],
    history: [entry({ n: 1, request: "botão azul", summary: "Azul." }), entry({ n: 2, undone: true, request: "sumiu" })],
  }, { origin: "https://site.com", generatedAt: new Date(2026, 8, 13, 10, 0) });
  assert.ok(withHistory.startsWith("# Ajustes solicitados — Preset «Home azul» — Home — Site\n"));
  assert.match(withHistory, /- Página: https:\/\/site\.com\/home\n/);
  assert.match(withHistory, /- Gerado em: 2026-09-13 10:00\n/);
  assert.match(withHistory, /- Pedidos a aplicar: 1\n/, "desfeitos guardados por engano não contam nem aparecem");
  assert.match(withHistory, /## Pedido 1 — «botão azul»/);
  assert.ok(!withHistory.includes("sumiu"));
  assert.ok(!withHistory.includes("versão anterior"));

  const legacy = buildPresetReport({
    name: "Antigo",
    ops: [
      { op: "setStyle", selector: "h1", name: "color", value: "#d32f2f", position: "" },
      { op: "setText", selector: "#cta", name: "", value: "Assinar", position: "" },
      { op: "remove", selector: "#banner", name: "", value: "", position: "" },
      { op: "injectCSS", selector: "", name: "", value: ".x{color:red}", position: "" },
    ],
  }, { origin: "https://site.com" });
  assert.ok(legacy.startsWith("# Ajustes solicitados — Preset «Antigo»\n"));
  assert.match(legacy, /- Página: https:\/\/site\.com\n/, "sem url guardada usa a origem");
  assert.match(legacy, /## Pedido 1 — «Preset «Antigo»»/);
  assert.match(legacy, /\*\*Como foi resolvido:\*\* Preset salvo por uma versão anterior da extensão/);
  assert.match(legacy, /- setStyle em `h1`: `color` "" → "#d32f2f"\n/);
  assert.match(legacy, /- setText em `#cta`: "" → "Assinar"\n/);
  assert.match(legacy, /- remove `#banner` — elemento removido:\n```html\n\(HTML não registrado\)\n```/);
  assert.match(legacy, /- injectCSS — CSS adicionado à página:\n```css\n\.x\{color:red\}\n```/);
  assert.ok(!legacy.includes("Elemento s1"));
});
