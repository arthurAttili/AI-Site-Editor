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
