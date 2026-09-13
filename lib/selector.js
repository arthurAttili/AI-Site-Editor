// lib/selector.js — gera seletor CSS estável e rótulo curto para um elemento.
// Módulo ES puro: nada de `document`/`window`/`chrome` globais — tudo entra via `el`,
// usando `el.ownerDocument` e `el.ownerDocument.defaultView`.

function isAiseName(name) {
  return typeof name === "string" && /aise/i.test(name);
}

function fallbackEscape(value) {
  const escaped = String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  return escaped.replace(/^(\d)/, (digit) => `\\${digit}`);
}

function cssEscape(el, value) {
  const win = el.ownerDocument && el.ownerDocument.defaultView;
  const esc = win && win.CSS && win.CSS.escape;
  return typeof esc === "function" ? esc(value) : fallbackEscape(value);
}

function usableClasses(el) {
  return Array.from(el.classList).filter((c) => c && !isAiseName(c));
}

// Retorna o id do elemento se ele existir, não conter "aise" e for único no documento.
function getUniqueId(el) {
  const id = el.id;
  if (!id || isAiseName(id)) return null;
  const doc = el.ownerDocument;
  const matches = doc.querySelectorAll(`#${cssEscape(el, id)}`);
  return matches.length === 1 && matches[0] === el ? id : null;
}

// Passo 2: `tag.c1.c2…` com classes filtradas, se o resultado for único no documento.
function classSelector(el) {
  const classes = usableClasses(el);
  if (classes.length === 0) return null;
  const doc = el.ownerDocument;
  const selector = `${el.localName}${classes.map((c) => `.${cssEscape(el, c)}`).join("")}`;
  const matches = doc.querySelectorAll(selector);
  return matches.length === 1 && matches[0] === el ? selector : null;
}

// Segmento de caminho para um nó: tag, com `:nth-of-type(n)` só quando há irmãos da mesma tag.
function segmentFor(node) {
  const tag = node.localName;
  const parent = node.parentElement;
  if (!parent) return tag;
  const sameTagSiblings = Array.from(parent.children).filter((c) => c.localName === tag);
  if (sameTagSiblings.length <= 1) return tag;
  const index = sameTagSiblings.indexOf(node) + 1;
  return `${tag}:nth-of-type(${index})`;
}

// Sobe de `el` até o `body`, coletando a cadeia de ancestrais (topo → el).
function collectAncestors(el) {
  const ancestors = [];
  let node = el;
  while (node) {
    ancestors.unshift(node);
    if (node.localName === "body") break;
    const parent = node.parentElement;
    if (!parent) break;
    node = parent;
  }
  return ancestors;
}

// Passo 3: caminho a partir do ancestral mais próximo com id único, ou do `body`.
function pathSelector(el) {
  const ancestors = collectAncestors(el);
  const elIndex = ancestors.length - 1;

  let rootIndex = 0;
  let rootId = null;
  for (let i = elIndex - 1; i >= 0; i--) {
    const uid = getUniqueId(ancestors[i]);
    if (uid) {
      rootIndex = i;
      rootId = uid;
      break;
    }
  }

  const segments = [rootId ? `#${cssEscape(el, rootId)}` : segmentFor(ancestors[rootIndex])];
  for (let i = rootIndex + 1; i <= elIndex; i++) {
    segments.push(segmentFor(ancestors[i]));
  }
  return segments.join(" > ");
}

export function stableSelector(el) {
  const uid = getUniqueId(el);
  if (uid) return `#${cssEscape(el, uid)}`;

  const cls = classSelector(el);
  if (cls) return cls;

  return pathSelector(el);
}

export function shortLabel(el) {
  const tag = el.localName;
  if (el.id && !isAiseName(el.id)) return `${tag}#${el.id}`;
  const classes = usableClasses(el).slice(0, 2);
  if (classes.length > 0) return `${tag}.${classes.join(".")}`;
  return tag;
}
