# aiSiteEditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extensão Chrome (MV3) que edita elementos de qualquer site por linguagem natural a partir do botão direito, com log no Console, sidebar na aba Elements, presets por site e aviso permanente de "site modificado".

**Architecture:** Content script é dono do estado da página (seleção, histórico, operações ativas) e aplica/desfaz operações estruturadas devolvidas pela IA. Background service worker cria o menu de contexto, chama o provedor de IA escolhido e faz relay entre DevTools/popup e a aba. Toda lógica pura (operações, seletores, prompt, provedores, storage) vive em `lib/` como ES modules testáveis em Node com jsdom; o content script os carrega por `import(chrome.runtime.getURL(...))`.

**Tech Stack:** Manifest V3, JavaScript puro (sem build), `node:test` + jsdom para testes, `fetch` direto para Anthropic / Gemini / OpenAI / endpoints compatíveis.

**Spec:** `docs/superpowers/specs/2026-09-13-aisiteeditor-design.md`

## Global Constraints

- Sem etapa de build: a pasta do repositório é carregada direto em `chrome://extensions` (padrão do yt-transcriptor).
- Modelos padrão: Claude `claude-opus-5`; Gemini `gemini-3.7-flash`; OpenAI e compatíveis: campo livre, atalhos com sugestão.
- Claude: cabeçalhos `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`, `anthropic-beta: server-side-fallback-2026-07-01`; corpo com `max_tokens: 16000`, `fallbacks: "default"`, `output_config.format = {type:"json_schema", schema}`; checar `stop_reason === "refusal"`.
- Contrato de operações: `{summary: string, ops: [{op, selector, name, value, position}]}` com todos os campos string obrigatórios.
- Aviso de site modificado nunca some enquanto houver operação ativa: banner ↔ pílula, badge "MOD", `console.warn`.
- Presets nascem com `autoApply: false`.
- Chaves só em `chrome.storage.local`. Nada de segredo no repositório.
- UI e textos em pt-BR. Commits pequenos, mensagens em pt-BR com prefixo `feat:`/`test:`/`docs:`/`chore:` e trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Módulos de `lib/` recebem `doc`/`storage` por parâmetro (nunca tocam `document`/`chrome` globais) para serem testáveis.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `manifest.json` | permissões, content script, devtools, popup, opções, `web_accessible_resources: lib/*` |
| `background.js` | menu de contexto, `AI_REQUEST`, `TEST_PROVIDER`, `LIST_MODELS`, relay DevTools↔aba, badge |
| `content.js` | estado da página, seleção por botão direito e Shift+clique, aplicar/desfazer, presets, painel, indicador, log |
| `lib/ops.js` | `validateOps`, `applyOp`, `applyOps`, `undoRecords` |
| `lib/selector.js` | `stableSelector`, `shortLabel` |
| `lib/sanitize.js` | `sanitizeHTML` |
| `lib/serialize.js` | `tagSelection`, `serializeElement`, `computedSummary`, `ancestorChain`, `buildSelectionContext` |
| `lib/prompt.js` | `OPS_SCHEMA`, `buildPrompt` |
| `lib/providers/json.js` | `extractJSON`, `parseOpsText` |
| `lib/providers/claude.js`, `gemini.js`, `openai.js` | `buildRequest`, `parseResponse` (+ `buildModelsRequest`, `parseModels` no openai) |
| `lib/providers/index.js` | `PROVIDERS`, `COMPAT_PRESETS`, `getProvider`, `ProviderError` |
| `lib/storage.js` | settings, presets, `stabilizeOps` |
| `lib/logger.js` | grupos no Console |
| `lib/ui/panel.js` | painel flutuante em Shadow DOM |
| `lib/ui/indicator.js` | banner + pílula |
| `devtools.html/js`, `sidebar.html/js/css` | sidebar "Editor IA" na aba Elements |
| `popup.html/js` | presets do site atual |
| `options.html/js` | provedor, chaves, modelos, idioma, posição do banner |
| `test/*.test.js`, `test/dom.js` | testes node:test + jsdom |
| `README.md` | instalação, chaves, privacidade, checklist manual |

---

### Task 1: Scaffold do projeto

**Files:**
- Create: `package.json`, `.gitignore`, `manifest.json`, `icons/icon{16,32,48,128}.png`, `test/dom.js`, `test/smoke.test.js`, `README.md` (stub)

**Interfaces:**
- Produces: `test/dom.js` exporta `makeDoc(html) → {dom, doc, win}` (jsdom com `pretendToBeVisual: true`).

- [ ] **Step 1: package.json e .gitignore**

```json
{
  "name": "aisiteeditor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/" },
  "devDependencies": { "jsdom": "^25.0.0" }
}
```
`.gitignore`: `node_modules/`, `*.zip`.

- [ ] **Step 2: manifest.json**

```json
{
  "manifest_version": 3,
  "name": "aiSiteEditor — editor de sites com IA",
  "version": "0.1.0",
  "description": "Edite qualquer elemento de qualquer site em linguagem natural, pelo botão direito. Log no Console, sidebar no Elements, presets por site.",
  "permissions": ["contextMenus", "storage", "activeTab", "tabs", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle" }],
  "web_accessible_resources": [{ "resources": ["lib/*"], "matches": ["<all_urls>"] }],
  "devtools_page": "devtools.html",
  "options_ui": { "page": "options.html", "open_in_tab": true },
  "action": { "default_title": "aiSiteEditor", "default_popup": "popup.html", "default_icon": { "16": "icons/icon16.png", "32": "icons/icon32.png", "48": "icons/icon48.png", "128": "icons/icon128.png" } },
  "icons": { "16": "icons/icon16.png", "32": "icons/icon32.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

- [ ] **Step 3: Ícones** — gerar com Python puro (zlib + struct) um círculo laranja `#ee8d49` com um "lápis" branco diagonal, nos quatro tamanhos. Script descartável em scratchpad.

- [ ] **Step 4: test/dom.js e smoke test**

```js
// test/dom.js
import { JSDOM } from "jsdom";
export function makeDoc(html = "<body></body>") {
  const dom = new JSDOM(`<!doctype html><html>${html}</html>`, { pretendToBeVisual: true });
  return { dom, doc: dom.window.document, win: dom.window };
}
```
```js
// test/smoke.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
test("jsdom funciona", () => {
  const { doc } = makeDoc("<body><p id='a'>oi</p></body>");
  assert.equal(doc.getElementById("a").textContent, "oi");
});
```

- [ ] **Step 5: `npm install` e `npm test`** → 1 passing.
- [ ] **Step 6: Commit** `chore: scaffold da extensão com manifest, ícones e testes`

---

### Task 2: lib/ops.js — aplicar e desfazer operações

**Files:** Create `lib/ops.js`, `test/ops.test.js`

**Interfaces:**
- Produces:
  - `OP_TYPES: string[]`
  - `validateOps(raw: unknown) → { ops: Op[], errors: string[] }` onde `Op = {op, selector, name, value, position}` (todas strings).
  - `applyOp(op: Op, doc: Document, opts?: {sanitize?: (html)=>string}) → Record` com `Record = { op, matched: number, changes: {target: string, before: string, after: string}[], warning?: string, undo(): void }`.
  - `applyOps(ops, doc, opts) → Record[]`.
  - `undoRecords(records: Record[]) → void` (ordem inversa).
  - `redoRecords(records, doc, opts) → Record[]` (reaplica `records.map(r => r.op)`).

- [ ] **Step 1: Testes**

```js
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
```

- [ ] **Step 2: Rodar** → falha (módulo não existe).
- [ ] **Step 3: Implementar `lib/ops.js`**

Pontos-chave: `validateOps` aceita `{ops:[...]}` ou array; `position` só válida em `insertHTML` (`beforebegin|afterbegin|beforeend|afterend`); `setStyle` exige `name`; `setAttr`/`removeAttr` exigem `name`; `addClass`/`removeClass`/`setText`/`setHTML`/`insertHTML`/`injectCSS` exigem `value`. `applyOp` faz `try { nodes = doc.querySelectorAll(sel) } catch { warning: "seletor inválido" }`. Para `remove`, guardar `{parent, next}` por nó e desfazer com `parent.insertBefore(node, next)`. Para `insertHTML`, criar `template`, sanitizar, coletar `childNodes` inseridos e desfazer removendo cada um. `before/after` do `setStyle` usam `el.style.getPropertyValue(name)`; ao desfazer, `setProperty` com valor antigo ou `removeProperty` se vazio. `target` no `changes` é o seletor da op (o content script troca por label legível no log).

- [ ] **Step 4: Rodar** → 8 passing.
- [ ] **Step 5: Commit** `feat: operações de edição com aplicar e desfazer`

---

### Task 3: lib/selector.js — seletor estável

**Files:** Create `lib/selector.js`, `test/selector.test.js`

**Interfaces:**
- Produces: `stableSelector(el: Element) → string` (único em `el.ownerDocument`); `shortLabel(el) → string` (`tag#id` ou `tag.c1.c2` até 2 classes, ou `tag`).

- [ ] **Step 1: Testes**

```js
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
```

- [ ] **Step 2: Rodar** → falha.
- [ ] **Step 3: Implementar** — `cssEscape = (s) => (el.ownerDocument.defaultView?.CSS?.escape ?? fallback)(s)`; fallback: escapa `[^a-zA-Z0-9_-]` com `\\`. Algoritmo: (1) `#id` se `doc.querySelectorAll('#'+esc).length===1`; (2) `tag.c1.c2…` (classes filtradas, sem `aise`) se único; (3) subir: para cada nível, `segment = tag` + (id → `#id` e para) ou `:nth-of-type(n)` quando há irmãos de mesma tag; juntar com ` > `; testar unicidade a cada nível e parar quando único ou chegar em `body`.
- [ ] **Step 4: Rodar** → passing.
- [ ] **Step 5: Commit** `feat: seletor CSS estável para presets`

---

### Task 4: lib/sanitize.js e lib/serialize.js

**Files:** Create `lib/sanitize.js`, `lib/serialize.js`, `test/sanitize.test.js`, `test/serialize.test.js`

**Interfaces:**
- Produces:
  - `sanitizeHTML(html: string, doc: Document) → string` — remove `script`, `iframe`, `object`, `embed`, atributos `on*`, e `href/src/action/formaction` que comecem com `javascript:` (case-insensitive, após trim).
  - `tagSelection(elements: Element[]) → string[]` — define `data-aise-id="s1".."sN"` e devolve ids.
  - `clearTags(doc)` — remove `data-aise-id` e `data-aise-pick` de todos.
  - `serializeElement(el, {maxDepth=3, maxChars=4000}) → string`.
  - `computedSummary(el, win) → Record<string,string>` com as 14 propriedades do spec.
  - `ancestorChain(el, max=5) → string` (`body > div#app > nav.menu`).
  - `buildSelectionContext(elements, {win, stableSelector, shortLabel}) → {id, tag, selector, label, ancestors, html, styles}[]`.

- [ ] **Step 1: Testes**

```js
// test/sanitize.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { sanitizeHTML } from "../lib/sanitize.js";
test("remove script, on* e javascript:", () => {
  const { doc } = makeDoc();
  const out = sanitizeHTML(`<a href=" JavaScript:alert(1)" onclick="x()">a</a><script>1</script><b>b</b><iframe src="x"></iframe>`, doc);
  assert.equal(out, `<a>a</a><b>b</b>`);
});
test("mantém href normal e estilos", () => {
  const { doc } = makeDoc();
  assert.equal(sanitizeHTML(`<a href="/x" style="color:red">a</a>`, doc), `<a href="/x" style="color:red">a</a>`);
});
```
```js
// test/serialize.test.js
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
```

- [ ] **Step 2: Rodar** → falha.
- [ ] **Step 3: Implementar.** `serializeElement`: clonar profundo, percorrer com profundidade; nós além de `maxDepth` viram `<tag …>…</tag>` (substitui filhos por um text node `…`); cortar `outerHTML` em `maxChars` com sufixo ` …[cortado]`. `computedSummary`: `win.getComputedStyle(el)` e as chaves `display, position, color, background-color, font-size, font-family, font-weight, padding, margin, width, height, border, border-radius`.
- [ ] **Step 4: Rodar** → passing.
- [ ] **Step 5: Commit** `feat: sanitização de HTML e serialização de contexto`

---

### Task 5: lib/prompt.js

**Files:** Create `lib/prompt.js`, `test/prompt.test.js`

**Interfaces:**
- Produces: `OPS_SCHEMA` (JSON Schema: object com `summary: string` e `ops: array<object{op: enum OP_TYPES, selector, name, value, position: string}>`, tudo `required`, `additionalProperties:false`); `buildPrompt({language, url, title, selection, history, request}) → {system: string, user: string}` onde `history = [{request, summary}]` (usa só os 10 últimos).

- [ ] **Step 1: Testes**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { OPS_SCHEMA, buildPrompt } from "../lib/prompt.js";
import { OP_TYPES } from "../lib/ops.js";

test("schema estrito e plano", () => {
  assert.equal(OPS_SCHEMA.additionalProperties, false);
  assert.deepEqual(OPS_SCHEMA.required, ["summary", "ops"]);
  const item = OPS_SCHEMA.properties.ops.items;
  assert.deepEqual(item.required, ["op", "selector", "name", "value", "position"]);
  assert.deepEqual(item.properties.op.enum, OP_TYPES);
});
test("prompt inclui seleção, histórico recente e idioma", () => {
  const history = Array.from({ length: 12 }, (_, i) => ({ request: `pedido ${i}`, summary: `res ${i}` }));
  const { system, user } = buildPrompt({
    language: "pt-BR", url: "https://x.com/a", title: "X",
    selection: [{ id: "s1", tag: "button", selector: "button.x", label: "button.x", ancestors: "body > div", html: "<button data-aise-id=\"s1\">ok</button>", styles: { color: "red" } }],
    history, request: "deixe vermelho",
  });
  assert.match(system, /pt-BR/);
  assert.match(system, /data-aise-id/);
  assert.match(system, /injectCSS/);
  assert.ok(user.includes("https://x.com/a"));
  assert.ok(user.includes("[s1]"));
  assert.ok(user.includes("pedido 11") && !user.includes("pedido 1\n"));
  assert.ok(user.trim().endsWith("deixe vermelho"));
});
```

- [ ] **Step 2: Rodar** → falha.
- [ ] **Step 3: Implementar.** System prompt (pt-BR, direto): papel de editor de DOM; devolver só JSON no schema; regras: um `setStyle` por propriedade; alvo selecionado via `[data-aise-id="sN"]`; `injectCSS` para padrões repetidos ou pseudo-classes; `setHTML`/`insertHTML` só quando texto/estilo não bastam; nunca `<script>`; manter acessibilidade e não quebrar layout; `summary` em uma frase no idioma `{language}`; se o pedido for impossível, `ops: []` e explicar no `summary`. User: cabeçalho com URL/título; bloco por elemento `[s1] button.x — seletor: …, ancestrais: …, estilos: k: v; …` seguido do HTML; bloco "Pedidos anteriores nesta sessão" (últimos 10) e por fim `Pedido atual:` com o texto.
- [ ] **Step 4: Rodar** → passing.
- [ ] **Step 5: Commit** `feat: prompt e schema das operações`

---

### Task 6: Provedores de IA

**Files:** Create `lib/providers/json.js`, `lib/providers/claude.js`, `lib/providers/gemini.js`, `lib/providers/openai.js`, `lib/providers/index.js`, `test/providers.test.js`

**Interfaces:**
- Produces:
  - `class ProviderError extends Error { constructor(message, {status, kind}) }` com `kind ∈ 'no-key'|'auth'|'rate'|'server'|'network'|'refusal'|'format'|'http'`.
  - `extractJSON(text) → object` (aceita cercas ```json, texto em volta; lança `ProviderError kind:'format'`).
  - `parseOpsText(text) → {summary, ops, errors}` (usa `validateOps`).
  - Cada provedor: `buildRequest(cfg, {system, user, schema}, opts={}) → {url, headers, body}`; `parseResponse(json) → {text, model}`; `mapHttpError(status, json) → ProviderError`.
  - `openai.js` extra: `buildModelsRequest(cfg) → {url, headers}`; `parseModels(json) → string[]`. `opts.jsonMode ∈ 'schema'|'object'|'none'`.
  - `index.js`: `PROVIDERS = { claude:{label:'Claude (Anthropic)'}, gemini:{label:'Gemini (Google)'}, openai:{label:'OpenAI'}, compat:{label:'Compatível com OpenAI'} }`; `COMPAT_PRESETS` (openrouter, groq, deepseek, mistral, xai, together, ollama, lmstudio com `{id,label,baseUrl,model,needsKey}`); `getProvider(id) → módulo`; `getProviderConfig(settings) → {apiKey, model, baseUrl}` (compat usa `providers.compat`, openai usa `baseUrl: 'https://api.openai.com/v1'`).

- [ ] **Step 1: Testes**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { extractJSON, parseOpsText } from "../lib/providers/json.js";
import * as claude from "../lib/providers/claude.js";
import * as gemini from "../lib/providers/gemini.js";
import * as openai from "../lib/providers/openai.js";
import { getProvider, COMPAT_PRESETS, getProviderConfig, ProviderError } from "../lib/providers/index.js";
import { OPS_SCHEMA } from "../lib/prompt.js";

const prompt = { system: "S", user: "U", schema: OPS_SCHEMA };

test("extractJSON tolera cercas e lixo", () => {
  assert.deepEqual(extractJSON("claro:\n```json\n{\"a\":1}\n```"), { a: 1 });
  assert.throws(() => extractJSON("nada aqui"), (e) => e instanceof ProviderError && e.kind === "format");
});
test("parseOpsText valida", () => {
  const r = parseOpsText('{"summary":"ok","ops":[{"op":"setText","selector":"p","name":"","value":"x","position":""}]}');
  assert.equal(r.ops.length, 1);
});
test("claude monta requisição conforme spec", () => {
  const { url, headers, body } = claude.buildRequest({ apiKey: "k", model: "claude-opus-5" }, prompt);
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(headers["x-api-key"], "k");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(body.model, "claude-opus-5");
  assert.equal(body.max_tokens, 16000);
  assert.equal(body.fallbacks, "default");
  assert.equal(body.system, "S");
  assert.deepEqual(body.messages, [{ role: "user", content: "U" }]);
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.output_config.format.schema, OPS_SCHEMA);
});
test("claude parse e refusal", () => {
  assert.deepEqual(claude.parseResponse({ model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] }), { text: "{}", model: "m" });
  assert.throws(() => claude.parseResponse({ stop_reason: "refusal", stop_details: { explanation: "x" }, content: [] }), (e) => e.kind === "refusal");
});
test("gemini monta requisição", () => {
  const { url, body } = gemini.buildRequest({ apiKey: "k", model: "gemini-3.7-flash" }, prompt);
  assert.ok(url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=k"));
  assert.equal(body.systemInstruction.parts[0].text, "S");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.ok(body.generationConfig.responseSchema);
  assert.equal(gemini.parseResponse({ candidates: [{ content: { parts: [{ text: "{}" }] } }], modelVersion: "g" }).text, "{}");
  assert.throws(() => gemini.parseResponse({ promptFeedback: { blockReason: "SAFETY" } }), (e) => e.kind === "refusal");
});
test("openai monta requisição com json_schema e fallback", () => {
  const cfg = { apiKey: "k", model: "gpt-x", baseUrl: "https://api.openai.com/v1" };
  const a = openai.buildRequest(cfg, prompt, { jsonMode: "schema" });
  assert.equal(a.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(a.headers.Authorization, "Bearer k");
  assert.equal(a.body.response_format.type, "json_schema");
  assert.equal(a.body.response_format.json_schema.strict, true);
  assert.equal(a.body.messages[0].role, "system");
  assert.equal(openai.buildRequest(cfg, prompt, { jsonMode: "object" }).body.response_format.type, "json_object");
  assert.equal(openai.buildRequest(cfg, prompt, { jsonMode: "none" }).body.response_format, undefined);
  const b = openai.buildRequest({ apiKey: "", model: "llama", baseUrl: "http://localhost:11434/v1/" }, prompt);
  assert.equal(b.url, "http://localhost:11434/v1/chat/completions");
  assert.equal(b.headers.Authorization, undefined);
  assert.equal(openai.parseResponse({ model: "m", choices: [{ message: { content: "{}" } }] }).text, "{}");
  assert.throws(() => openai.parseResponse({ choices: [{ message: { refusal: "não" } }] }), (e) => e.kind === "refusal");
  assert.deepEqual(openai.parseModels({ data: [{ id: "b" }, { id: "a" }] }), ["a", "b"]);
});
test("mapHttpError classifica", () => {
  assert.equal(claude.mapHttpError(401, {}).kind, "auth");
  assert.equal(openai.mapHttpError(429, {}).kind, "rate");
  assert.equal(gemini.mapHttpError(503, {}).kind, "server");
  assert.equal(openai.mapHttpError(400, { error: { message: "response_format not supported" } }).kind, "http");
});
test("index resolve provedor e config", () => {
  assert.equal(getProvider("compat"), openai);
  assert.ok(COMPAT_PRESETS.find(p => p.id === "ollama" && p.needsKey === false));
  const settings = { provider: "compat", providers: { compat: { baseUrl: "https://api.groq.com/openai/v1", apiKey: "g", model: "llama-3.3" } } };
  assert.deepEqual(getProviderConfig(settings), { apiKey: "g", model: "llama-3.3", baseUrl: "https://api.groq.com/openai/v1" });
  assert.equal(getProviderConfig({ provider: "openai", providers: { openai: { apiKey: "o", model: "gpt" } } }).baseUrl, "https://api.openai.com/v1");
});
```

- [ ] **Step 2: Rodar** → falha.
- [ ] **Step 3: Implementar** os cinco módulos. `mapHttpError` comum em `json.js` (`httpErrorToProviderError(status, json, providerLabel)`): 401/403 → auth "chave inválida ou sem permissão"; 429 → rate; ≥500 → server; senão http com a mensagem do corpo (`error.message` / `error?.message` / `message`). Gemini `responseSchema`: mesmo `OPS_SCHEMA` sem `additionalProperties` (Gemini rejeita) — função `toGeminiSchema(schema)` que remove essa chave recursivamente.
- [ ] **Step 4: Rodar** → passing.
- [ ] **Step 5: Commit** `feat: provedores Claude, Gemini, OpenAI e compatíveis`

---

### Task 7: lib/storage.js

**Files:** Create `lib/storage.js`, `test/storage.test.js`

**Interfaces:**
- Produces:
  - `DEFAULT_SETTINGS = { provider:'claude', language:'pt-BR', indicatorPosition:'bottom', providers:{ claude:{apiKey:'',model:'claude-opus-5'}, gemini:{apiKey:'',model:'gemini-3.7-flash'}, openai:{apiKey:'',model:''}, compat:{presetId:'openrouter', baseUrl:'https://openrouter.ai/api/v1', apiKey:'', model:''} } }`
  - `getSettings(storage) → Promise<Settings>` (merge profundo com defaults); `saveSettings(storage, patch)`.
  - `getPresets(storage, origin) → Promise<Preset[]>`; `savePreset(storage, origin, {name, ops}) → Preset` (`id = crypto.randomUUID()`, `autoApply:false`, timestamps); `updatePreset(storage, origin, id, patch)`; `deletePreset(storage, origin, id)`.
  - `stabilizeOps(ops, selection: {id, selector}[]) → Op[]` (troca `[data-aise-id="sN"]` pelo `selector`; aceita aspas simples/duplas/sem aspas).
  - `storage` é um objeto com `get(keys) → Promise<obj>` e `set(obj) → Promise` (a API `chrome.storage.local` já é assim).

- [ ] **Step 1: Testes**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { getSettings, saveSettings, getPresets, savePreset, updatePreset, deletePreset, stabilizeOps, DEFAULT_SETTINGS } from "../lib/storage.js";

function memStorage() { const data = {}; return {
  async get(keys) { const ks = Array.isArray(keys) ? keys : [keys]; const out = {}; for (const k of ks) if (k in data) out[k] = structuredClone(data[k]); return out; },
  async set(obj) { Object.assign(data, structuredClone(obj)); }, data }; }

test("settings com defaults e merge", async () => {
  const s = memStorage();
  assert.deepEqual(await getSettings(s), DEFAULT_SETTINGS);
  await saveSettings(s, { provider: "gemini", providers: { gemini: { apiKey: "k" } } });
  const got = await getSettings(s);
  assert.equal(got.provider, "gemini");
  assert.equal(got.providers.gemini.apiKey, "k");
  assert.equal(got.providers.gemini.model, "gemini-3.7-flash");
  assert.equal(got.providers.claude.model, "claude-opus-5");
});
test("presets CRUD por origin, autoApply nasce falso", async () => {
  const s = memStorage();
  const p = await savePreset(s, "https://x.com", { name: "A", ops: [{ op: "remove", selector: "#a", name: "", value: "", position: "" }] });
  assert.equal(p.autoApply, false);
  assert.ok(p.id && p.createdAt);
  assert.equal((await getPresets(s, "https://x.com")).length, 1);
  assert.equal((await getPresets(s, "https://y.com")).length, 0);
  await updatePreset(s, "https://x.com", p.id, { autoApply: true });
  assert.equal((await getPresets(s, "https://x.com"))[0].autoApply, true);
  await deletePreset(s, "https://x.com", p.id);
  assert.equal((await getPresets(s, "https://x.com")).length, 0);
});
test("stabilizeOps troca marcadores por seletores estáveis", () => {
  const out = stabilizeOps([
    { op: "setStyle", selector: '[data-aise-id="s1"]', name: "color", value: "red", position: "" },
    { op: "setStyle", selector: "[data-aise-id='s2'] a", name: "color", value: "red", position: "" },
    { op: "injectCSS", selector: "", name: "", value: "[data-aise-id=s1]{x:y}", position: "" },
  ], [{ id: "s1", selector: "#a" }, { id: "s2", selector: "nav.menu" }]);
  assert.equal(out[0].selector, "#a");
  assert.equal(out[1].selector, "nav.menu a");
  assert.equal(out[2].value, "#a{x:y}");
});
```

- [ ] **Step 2: Rodar** → falha. **Step 3: Implementar.** **Step 4: Rodar** → passing.
- [ ] **Step 5: Commit** `feat: settings e presets em storage local`

---

### Task 8: lib/logger.js

**Files:** Create `lib/logger.js`, `test/logger.test.js`

**Interfaces:**
- Produces: `createLogger(console) → { request({n, request, targets, provider, model, ms, records, summary}), error({n, request, message}), undo({n, request}), preset({name, applied, total, missing}), modifiedWarning({activeCount, presetNames}), originalMode(on) }`. Prefixo `[Editor IA]`. `targets = [{id, label}]`. Cada record vira linha `✔ op label name: "antes" → "depois"` ou `⚠ …` quando `warning`.

- [ ] **Step 1: Teste**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../lib/logger.js";
function spyConsole() { const calls = []; const f = (name) => (...a) => calls.push([name, a.map(String).join(" ")]); return { calls, group: f("group"), groupEnd: f("groupEnd"), log: f("log"), warn: f("warn"), error: f("error") }; }
test("request loga grupo com alvos, provedor e mudanças", () => {
  const c = spyConsole(); const log = createLogger(c);
  log.request({ n: 3, request: "vermelho", targets: [{ id: "s1", label: "button.x" }], provider: "claude", model: "claude-opus-5", ms: 2100,
    records: [{ op: { op: "setStyle", selector: "[data-aise-id=\"s1\"]", name: "color" }, matched: 1, changes: [{ target: "button.x", before: "", after: "red" }] },
              { op: { op: "setText", selector: ".nada" }, matched: 0, changes: [], warning: "seletor não encontrou elementos" }], summary: "ok" });
  const text = c.calls.map(x => x[1]).join("\n");
  assert.match(text, /\[Editor IA\] Pedido #3 — "vermelho"/);
  assert.match(text, /s1 = button.x/);
  assert.match(text, /claude · claude-opus-5 · 2,1 s/);
  assert.match(text, /✔ setStyle button.x color: "" → "red"/);
  assert.match(text, /⚠ setText \.nada/);
  assert.equal(c.calls.at(-1)[0], "groupEnd");
});
test("modifiedWarning usa console.warn", () => {
  const c = spyConsole(); createLogger(c).modifiedWarning({ activeCount: 4, presetNames: ["X"] });
  assert.equal(c.calls[0][0], "warn"); assert.match(c.calls[0][1], /MODIFICADO por você/);
});
```

- [ ] **Steps 2-4:** rodar/implementar/rodar. **Step 5: Commit** `feat: log formatado no Console`

---

### Task 9: background.js

**Files:** Create `background.js`

**Interfaces:**
- Consumes: `lib/providers/index.js` (`getProvider`, `getProviderConfig`, `ProviderError`), `lib/providers/json.js` (`parseOpsText`), `lib/storage.js` (`getSettings`).
- Produces (mensagens `chrome.runtime.onMessage`, sempre respondendo `{ok, ...}`):
  - `{type:'AI_REQUEST', system, user, schema}` → `{ok:true, summary, ops, errors, provider, model, ms}` ou `{ok:false, error, kind}`.
  - `{type:'TEST_PROVIDER', settings}` → `{ok, model?, error?}` (manda pedido mínimo: user `"Responda com {\"summary\":\"ok\",\"ops\":[]}"`).
  - `{type:'LIST_MODELS', settings}` → `{ok, models:[...]}` (só openai/compat).
  - `{type:'STATE_CHANGED', state}` vindo do content: atualiza badge (`MOD` vermelho se `state.activeCount>0 && !state.originalMode`, `ORIG` cinza se `originalMode`, vazio caso contrário) e repassa para portas DevTools daquela `sender.tab.id`.
  - `{type:'OPEN_OPTIONS'}` → `chrome.runtime.openOptionsPage()`.
  - Porta `aise-devtools`: primeira mensagem `{type:'INIT', tabId}`; demais `{type, ...}` são repassadas para `chrome.tabs.sendMessage(tabId, msg)` e a resposta devolvida por `port.postMessage({type:'REPLY', reqId, reply})`.
  - Menu de contexto `aise-edit` ("Editar com IA"), `contexts:['all']`; ao clicar: `chrome.tabs.sendMessage(tab.id, {type:'OPEN_EDITOR', frameId})`; se falhar (content script ausente), injeta `content.js` com `chrome.scripting.executeScript` e tenta de novo; se ainda falhar, `chrome.notifications` não está nas permissões — usar `chrome.action.setBadgeText({text:'!'})` por 3 s e `console.warn`.

- [ ] **Step 1: Implementar `callProvider(settings, prompt)`** com estratégia: `provider = getProvider(settings.provider)`; para openai/compat tentar `jsonMode: 'schema'`, se `ProviderError kind:'http'` e status 400 tentar `'object'`, depois `'none'`; `fetch` com `AbortController` de 180 s; `res.ok` falso → `provider.mapHttpError(res.status, await res.json().catch(()=>({})))`; `parseResponse` → `parseOpsText`. Erros de rede → `ProviderError('Sem conexão com o provedor', {kind:'network'})`.
- [ ] **Step 2: Listeners** (`onInstalled` cria menu; `onMessage` com `return true` para async; `onConnect` para portas; `chrome.tabs.onRemoved` limpa portas).
- [ ] **Step 3: Teste manual mínimo:** carregar descompactada, ver menu "Editar com IA" ao clicar com botão direito.
- [ ] **Step 4: Commit** `feat: service worker com menu de contexto e chamadas de IA`

---

### Task 10: UI em Shadow DOM — painel e indicador

**Files:** Create `lib/ui/panel.js`, `lib/ui/indicator.js`, `lib/ui/styles.js` (strings CSS), `test/ui.test.js`

**Interfaces:**
- Produces:
  - `createPanel(doc, handlers) → panel` com `handlers = {onSubmit(text), onUndo(requestId), onUndoAll(), onRedoAll(), onSavePreset(), onClose(), onRemoveSelection(id), onOpenOptions()}` e métodos `show(anchorRect?)`, `hide()`, `isOpen()`, `setSelection([{id,label}])`, `setBusy(bool, text?)`, `setHistory([{id, n, request, summary, undone, opsCount}])`, `setError(msg|null)`, `toast(msg)`, `focus()`.
  - `createIndicator(doc, {position, onViewOriginal, onEdit, onDisableAuto}) → indicator` com `update({activeCount, originalMode, presetNames, fromPreset, applied, total})`, `setPosition(pos)`, `destroy()`. Regras: `activeCount===0 && !originalMode` → host removido; caso contrário host visível como banner (padrão) ou pílula (após "Minimizar"); texto muda entre "MODIFICADA por você" e "site ORIGINAL (N alterações suas desligadas)"; botão "Desligar auto-aplicar" só se `fromPreset`.
  - Hosts: `<aise-panel>` e `<aise-indicator>` com `shadowRoot` (mode `open` para testes), `position: fixed`, `z-index: 2147483647`, `all: initial` no container interno, fonte system-ui, cor de destaque `#ee8d49`.

- [ ] **Step 1: Testes (jsdom)**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { createPanel } from "../lib/ui/panel.js";
import { createIndicator } from "../lib/ui/indicator.js";

test("painel abre, lista seleção e envia pedido", () => {
  const { doc } = makeDoc("<body></body>");
  let sent = null;
  const p = createPanel(doc, { onSubmit: (t) => (sent = t), onUndo() {}, onUndoAll() {}, onRedoAll() {}, onSavePreset() {}, onClose() {}, onRemoveSelection() {}, onOpenOptions() {} });
  p.show(); p.setSelection([{ id: "s1", label: "button.x" }]);
  const root = doc.querySelector("aise-panel").shadowRoot;
  assert.ok(root.textContent.includes("button.x"));
  root.querySelector("textarea").value = "vermelho";
  root.querySelector("form").dispatchEvent(new doc.defaultView.Event("submit", { cancelable: true }));
  assert.equal(sent, "vermelho");
  p.setHistory([{ id: "r1", n: 1, request: "vermelho", summary: "ok", undone: false, opsCount: 2 }]);
  assert.ok(root.textContent.includes("ok"));
  p.hide(); assert.equal(p.isOpen(), false);
});
test("indicador some sem alterações, mostra banner e alterna para original", () => {
  const { doc } = makeDoc("<body></body>");
  const ind = createIndicator(doc, { position: "bottom", onViewOriginal() {}, onEdit() {}, onDisableAuto() {} });
  ind.update({ activeCount: 0, originalMode: false, presetNames: [], fromPreset: false, applied: 0, total: 0 });
  assert.equal(doc.querySelector("aise-indicator"), null);
  ind.update({ activeCount: 4, originalMode: false, presetNames: ["Menu"], fromPreset: true, applied: 4, total: 4 });
  const root = doc.querySelector("aise-indicator").shadowRoot;
  assert.match(root.textContent, /MODIFICADA por você/);
  assert.match(root.textContent, /Menu/);
  assert.ok(root.querySelector("[data-action=disable-auto]"));
  root.querySelector("[data-action=minimize]").click();
  assert.match(root.textContent, /Modificado por você · 4/);
  ind.update({ activeCount: 4, originalMode: true, presetNames: ["Menu"], fromPreset: true, applied: 4, total: 4 });
  assert.match(root.textContent, /ORIGINAL/);
});
```

- [ ] **Steps 2-4:** rodar/implementar/rodar. **Step 5: Commit** `feat: painel flutuante e indicador de site modificado`

---

### Task 11: content.js — orquestração

**Files:** Create `content.js`

**Interfaces:**
- Consumes: tudo de `lib/` via `const L = await loadLibs()` que faz `import(chrome.runtime.getURL('lib/x.js'))`.
- Produces: responde às mensagens `OPEN_EDITOR`, `PICK_MARKED`, `REQUEST_EDIT {text}`, `GET_STATE`, `UNDO {requestId}`, `UNDO_ALL`, `REDO_ALL`, `TOGGLE_ORIGINAL`, `REAPPLY`, `SAVE_PRESET {name}`, `APPLY_PRESET {presetId}`, `DISABLE_AUTO`; emite `STATE_CHANGED` para o background após qualquer mudança. Estado público (`publicState()`): `{ selection:[{id,label}], history:[{id,n,request,summary,undone,opsCount}], activeCount, originalMode, presetsApplied:[{id,name,applied,total}], fromPreset, origin, url, title }`.

- [ ] **Step 1: Estado e guarda de idempotência** (`if (window.__aiseLoaded) return; window.__aiseLoaded = true;`).
- [ ] **Step 2: Captura do botão direito** — `document.addEventListener('contextmenu', e => lastTarget = e.target, true)`. `OPEN_EDITOR` → `selectOnly(lastTarget)`, `panel.show(rect)`, highlight (outline via `injectCSS` próprio: `[data-aise-id]{outline:2px dashed #ee8d49 !important; outline-offset:2px}` num `<style data-aise-ui>` que **não** conta como alteração).
- [ ] **Step 3: Shift+clique** — enquanto o painel estiver aberto, `click` em captura com `e.shiftKey` → `preventDefault`, alterna elemento na seleção (ignora cliques dentro dos hosts `aise-*`).
- [ ] **Step 4: `submitRequest(text)`** — monta `selection ctx` (`tagSelection` + `buildSelectionContext`), `buildPrompt`, `chrome.runtime.sendMessage({type:'AI_REQUEST', ...})`; em sucesso: `records = applyOps(ops, document, {sanitize})`, empurra `{id, n, request, summary, ops, records, undone:false, stableSelection:[{id,selector}]}` no histórico, `logger.request`, `panel.setHistory`, `refresh()`. Em erro: `panel.setError(msg)`, `logger.error`; se `kind==='no-key'` botão "Abrir opções".
- [ ] **Step 5: Desfazer** — `undoRequest(id)`: `undoRecords(entry.records)`, `entry.undone = true`; `redoRequest`: `entry.records = redoRecords(entry.records, document)`. `TOGGLE_ORIGINAL`: `originalMode = !originalMode`; ao ligar, desfaz todas as entradas não desfeitas (guardando quais) e presets; ao desligar, reaplica as mesmas.
- [ ] **Step 6: `refresh()`** — `activeCount = soma de opsCount das entradas ativas + ops de presets aplicados`; `indicator.update(...)`; `chrome.runtime.sendMessage({type:'STATE_CHANGED', state: publicState()})`; `logger.originalMode` quando alterna.
- [ ] **Step 7: Presets** — `SAVE_PRESET`: `ops = history.filter(!undone).flatMap(e => stabilizeOps(e.ops, e.stableSelection))`, `savePreset(chrome.storage.local, location.origin, {name, ops})`, `panel.toast(...)`. `APPLY_PRESET`: `applyOps(preset.ops)`; registra em `presetsApplied` com `applied = records.filter(r=>r.matched>0).length`, `total = ops.length`; `logger.preset`. Ao carregar: `getPresets(origin).filter(p=>p.autoApply)` → aplica cada um, `logger.modifiedWarning`. `DISABLE_AUTO`: `updatePreset(... {autoApply:false})` para todos os presets aplicados; toast "Auto-aplicar desligado. No próximo carregamento você verá o site original."
- [ ] **Step 8: `PICK_MARKED`** — `el = document.querySelector('[data-aise-pick]')`; remove atributo; `selectOnly(el)`; abre painel.
- [ ] **Step 9: Teste manual** em `https://example.com`: botão direito no `h1` → painel → "deixe o título vermelho e centralizado" → ver mudança, Console, desfazer, Shift+clique no parágrafo, novo pedido, salvar preset, popup (Task 13) etc.
- [ ] **Step 10: Commit** `feat: content script com seleção, edição, desfazer e presets`

---

### Task 12: DevTools — sidebar na aba Elements

**Files:** Create `devtools.html`, `devtools.js`, `sidebar.html`, `sidebar.js`, `sidebar.css`

**Interfaces:**
- Consumes: porta `aise-devtools` do background (Task 9) e mensagens do content (Task 11).
- `devtools.js`: `chrome.devtools.panels.elements.createSidebarPane("Editor IA", pane => pane.setPage("sidebar.html"))`.
- `sidebar.js`: conecta porta, envia `INIT` com `chrome.devtools.inspectedWindow.tabId`; `send(msg) → Promise<reply>` com `reqId` incremental; ao abrir e em `chrome.devtools.panels.elements.onSelectionChanged`, roda `inspectedWindow.eval("(()=>{const e=$0;if(!e)return '';return e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.classList.length?'.'+[...e.classList].slice(0,2).join('.'):'')})()")` e mostra "Selecionado: button.x". Botão **Usar elemento selecionado** → `eval("$0&&$0.setAttribute('data-aise-pick','1')")` então `send({type:'PICK_MARKED'})`. Textarea + **Enviar** → `send({type:'REQUEST_EDIT', text})`. Recebe `STATE_CHANGED` pela porta e renderiza seleção, histórico (com botão Desfazer → `send({type:'UNDO', requestId})`), **Ver original**, **Salvar preset** (prompt de nome), **Abrir opções**. Ao abrir, pede `GET_STATE`.

- [ ] **Step 1: Implementar** os cinco arquivos (CSS respeitando `prefers-color-scheme` do DevTools).
- [ ] **Step 2: Teste manual:** abrir DevTools → Elements → sidebar "Editor IA"; selecionar um nó; "Usar elemento selecionado"; enviar pedido; ver histórico espelhado e log no Console.
- [ ] **Step 3: Commit** `feat: sidebar Editor IA na aba Elements`

---

### Task 13: Popup — presets do site atual

**Files:** Create `popup.html`, `popup.js`, `popup.css`

**Interfaces:**
- Consumes: `lib/storage.js` (import ESM direto, `chrome.storage.local`), mensagens do content via `chrome.tabs.sendMessage(tabId, …)`.
- Comportamento: pega aba ativa (`chrome.tabs.query({active:true,currentWindow:true})`); se URL não é http(s), mostra "Esta página não pode ser editada". Pede `GET_STATE`; mostra linha de status ("Site modificado por você · 4 alterações" / "Site original" / "Sem alterações"), botão **Ver original / Ver modificado** (`TOGGLE_ORIGINAL`), **Desfazer tudo**. Lista presets do `origin`: nome, `N alterações`, chave **Auto-aplicar** (`updatePreset`), **Aplicar agora** (`APPLY_PRESET`), **Remover** (`deletePreset` com confirm). Aviso fixo em texto pequeno: "Presets com auto-aplicar ligado mudam o site ao carregar. O banner laranja sempre indica quando você está vendo uma versão modificada." Link **Opções**.

- [ ] **Step 1: Implementar.** **Step 2: Teste manual** (ligar auto-aplicar, recarregar, ver banner + badge + warn; desligar). **Step 3: Commit** `feat: popup com gestão de presets por site`

---

### Task 14: Opções

**Files:** Create `options.html`, `options.js`, `options.css`

**Interfaces:**
- Consumes: `lib/storage.js`, `lib/providers/index.js` (`PROVIDERS`, `COMPAT_PRESETS`), mensagens `TEST_PROVIDER` e `LIST_MODELS` do background.
- Campos: **Provedor** (select com `PROVIDERS`); seção por provedor mostrada conforme seleção: Claude (chave, modelo padrão `claude-opus-5`), Gemini (chave, modelo), OpenAI (chave, modelo), Compatível (select de atalho `COMPAT_PRESETS` que preenche URL base + modelo sugerido e mostra "sem chave" quando `needsKey:false`; URL base editável; chave; modelo; botão **Listar modelos** que popula um `datalist`). **Testar conexão** por provedor mostra "✔ ok (modelo X)" ou o erro. **Idioma das respostas** (pt-BR padrão, texto livre). **Posição do aviso** (rodapé/topo). **Salvar** com toast. Chaves em `input type=password` com botão mostrar/ocultar.

- [ ] **Step 1: Implementar.** **Step 2: Teste manual** com pelo menos um provedor real. **Step 3: Commit** `feat: página de opções com múltiplos provedores`

---

### Task 15: README, checklist manual e fechamento

**Files:** Modify `README.md`

- [ ] **Step 1: README** com: o que faz (3 linhas), instalação (carregar descompactada), configurar provedor (links para obter chave: Anthropic, Google AI Studio, OpenAI, OpenRouter, Groq; Ollama/LM Studio locais), como usar (botão direito, Shift+clique, sidebar Elements, Console), presets e o aviso de site modificado (por que existe e que não pode ser desligado), privacidade (o que é enviado ao provedor; chaves só locais), limitações (SPAs, seletores que mudam), desenvolvimento (`npm install`, `npm test`), checklist manual de QA (lista da seção 8 do spec).
- [ ] **Step 2: `npm test`** completo verde.
- [ ] **Step 3: Commit** `docs: README com instalação, uso e checklist de QA`

---

## Self-review (feito ao escrever)

- Cobertura do spec: 3.1 → T11; 3.2 → T12; 3.3 → T7/T11/T13; 3.4 → T10/T11/T9 (badge); 4.2-4.5 → T2-T5; 4.6 → T6/T9/T14; 4.7 → T9/T11/T12/T13; 4.8 → T7; 5 → T8; 6 → T6 (`mapHttpError`), T9, T11; 7 → T4, T10; 8 → todos os `test/*.test.js` + README.
- Simplificação frente ao spec: `host_permissions: ["<all_urls>"]` já cobre qualquer URL base (inclusive `localhost`), então não há pedido de permissão em tempo de execução nas opções.
- Nomes consistentes: `Record.changes[{target,before,after}]`, `Op{op,selector,name,value,position}`, `stabilizeOps(ops, [{id,selector}])`, mensagens em SCREAMING_CASE listadas em T9/T11.
