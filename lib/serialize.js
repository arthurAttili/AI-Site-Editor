// lib/serialize.js — marcação de seleção e serialização de contexto para o modelo.
// Módulo ES puro: nada de `document`/`window`/`chrome` globais — tudo entra via `el`,
// `doc`, `win`, usando `el.ownerDocument` quando necessário.

import { shortLabel } from "./selector.js";

const CUT_SUFFIX = "…[cortado]";

const STYLE_KEYS = [
  "display",
  "position",
  "color",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "padding",
  "margin",
  "width",
  "height",
  "border",
  "border-radius",
];

export function tagSelection(elements) {
  return elements.map((el, i) => {
    const id = `s${i + 1}`;
    el.setAttribute("data-aise-id", id);
    return id;
  });
}

export function clearTags(doc) {
  doc.querySelectorAll("[data-aise-id]").forEach((el) => el.removeAttribute("data-aise-id"));
  doc.querySelectorAll("[data-aise-pick]").forEach((el) => el.removeAttribute("data-aise-pick"));
}

// Colapsa recursivamente: elementos com profundidade > maxDepth têm seus filhos
// substituídos por um único nó de texto "…". `depth` do elemento raiz é 0.
function collapseDeep(el, depth, maxDepth) {
  if (depth > maxDepth) {
    el.textContent = "…";
    return;
  }
  Array.from(el.children).forEach((child) => collapseDeep(child, depth + 1, maxDepth));
}

export function serializeElement(el, { maxDepth = 3, maxChars = 4000 } = {}) {
  const clone = el.cloneNode(true);
  collapseDeep(clone, 0, maxDepth);
  const html = clone.outerHTML;
  if (html.length > maxChars) {
    return html.slice(0, maxChars) + CUT_SUFFIX;
  }
  return html;
}

export function computedSummary(el, win) {
  const cs = win.getComputedStyle(el);
  const out = {};
  for (const key of STYLE_KEYS) {
    out[key] = cs.getPropertyValue(key);
  }
  return out;
}

// Rótulos dos ancestrais do mais distante ao mais próximo, excluindo `html` e o
// próprio elemento, limitado aos `max` ancestrais mais próximos.
export function ancestorChain(el, max = 5) {
  const ancestors = [];
  let node = el.parentElement;
  while (node) {
    if (node.localName === "html") break;
    ancestors.unshift(node);
    node = node.parentElement;
  }
  return ancestors.slice(-max).map((n) => shortLabel(n)).join(" > ");
}

export function buildSelectionContext(elements, { win, stableSelector, shortLabel: label }) {
  return elements.map((el) => ({
    id: el.dataset.aiseId,
    tag: el.localName,
    selector: stableSelector(el),
    label: label(el),
    ancestors: ancestorChain(el),
    html: serializeElement(el),
    styles: computedSummary(el, win),
  }));
}

// ---------------------------------------------------------------------------
// Estrutura da página (outline) — visão compacta do documento inteiro para o
// modelo entender o contexto ao redor da seleção e poder alvejar outros
// elementos (irmãos, a seção inteira, a página toda). Uma linha por elemento,
// indentada pela profundidade: `tag#id.classe "texto próprio" [sN]`. Cada
// rótulo também funciona como seletor CSS relativo ao pai (ganha
// `:nth-of-type(n)` quando é ambíguo entre irmãos), então o modelo consegue
// montar `main > section.hero:nth-of-type(2) > h2` a partir das linhas.
// ---------------------------------------------------------------------------

const OUTLINE_SKIP = new Set(["script", "style", "noscript", "template", "link", "meta", "head", "title", "base"]);
// Elementos cujo interior não interessa (ou é enorme): viram uma linha só.
const OUTLINE_LEAF = new Set(["svg", "video", "audio", "canvas", "iframe", "object", "select", "textarea", "math"]);
const OUTLINE_ATTR_HINT = { a: "href", img: "alt", input: "placeholder", button: "aria-label" };

function isAiseElement(el) {
  return typeof el.localName === "string" && el.localName.startsWith("aise-");
}

function shortText(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// Texto direto do elemento (só os nós de texto filhos), não o dos descendentes.
function ownText(el, max) {
  let t = "";
  for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
  return shortText(t, max);
}

function containsSelection(el) {
  return el.hasAttribute("data-aise-id") || !!el.querySelector("[data-aise-id]");
}

// Rótulo que serve de seletor relativo ao pai: `tag#id`, `tag.c1.c2` ou `tag`;
// quando outro irmão tem o mesmo rótulo, acrescenta `:nth-of-type(n)`.
function outlineLabel(el) {
  const label = shortLabel(el);
  const parent = el.parentElement;
  if (!parent || (el.id && label.includes("#"))) return label;
  const sameTag = Array.from(parent.children).filter((c) => c.localName === el.localName);
  if (sameTag.length <= 1) return label;
  const ambiguous = sameTag.some((c) => c !== el && shortLabel(c) === label);
  return ambiguous ? `${label}:nth-of-type(${sameTag.indexOf(el) + 1})` : label;
}

export function serializeOutline(doc, { root, maxDepth = 8, maxChildren = 15, maxChars = 6000, maxText = 40 } = {}) {
  const start = root || doc.body;
  if (!start) return "";
  const lines = [];
  let chars = 0;
  let cut = false;

  function push(line) {
    if (cut) return false;
    if (chars + line.length + 1 > maxChars) {
      cut = true;
      return false;
    }
    lines.push(line);
    chars += line.length + 1;
    return true;
  }

  function walk(el, depth) {
    if (cut) return;
    const indent = "  ".repeat(depth);
    let line = indent + outlineLabel(el);
    const hintAttr = OUTLINE_ATTR_HINT[el.localName];
    const hint = hintAttr ? shortText(el.getAttribute(hintAttr), maxText) : "";
    if (hint) line += ` [${hintAttr}="${hint}"]`;
    const text = ownText(el, maxText);
    if (text) line += ` "${text}"`;
    const id = el.getAttribute("data-aise-id");
    if (id) line += ` [${id}]`;
    if (!push(line)) return;

    if (OUTLINE_LEAF.has(el.localName)) return;
    const kids = Array.from(el.children).filter((c) => !OUTLINE_SKIP.has(c.localName) && !isAiseElement(c));
    const over = depth >= maxDepth;
    // Além da profundidade só desce pelo caminho que leva a um selecionado;
    // dentro dela mostra os primeiros `maxChildren` (mais os que contêm seleção).
    const shown = kids.filter((k, i) => (over ? containsSelection(k) : i < maxChildren || containsSelection(k)));
    for (const k of shown) walk(k, depth + 1);
    const omitted = kids.length - shown.length;
    if (omitted > 0) push(`${indent}  … +${omitted} elemento(s) omitido(s)`);
  }

  walk(start, 0);
  if (cut) lines.push(CUT_SUFFIX);
  return lines.join("\n");
}
