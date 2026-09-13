// lib/sanitize.js — sanitiza HTML antes de inserir no DOM da página alvo.
// Módulo ES puro: nada de `document`/`window`/`chrome` globais — tudo entra via `doc`.

// `template` está aqui porque `querySelectorAll` não desce para dentro do
// `content` de um template: um `<template><script>…</script></template>` que
// sobrevivesse levaria o script junto, invisível para as queries seguintes.
// `base`/`meta`/`link` sequestram destino de links, refresh e folhas de estilo
// da página inteira. Os elementos SVG de animação (`animate` e parentes)
// escrevem em qualquer atributo do alvo — inclusive `href` — em tempo de
// execução, contornando a checagem de atributos abaixo.
const DANGEROUS_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "base",
  "meta",
  "link",
  "template",
  "animate",
  "set",
  "animateTransform",
  "animateMotion",
];

const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href"];

// Atributo que embute um documento inteiro: nada dentro dele passa pelas
// regras daqui.
const EMBEDDED_DOC_ATTRS = ["srcdoc"];

// `expression()` (IE), `url(javascript:…)` e `-moz-binding` executam script a
// partir de um valor de CSS.
const DANGEROUS_STYLE_RE = /(expression\s*\(|url\s*\(\s*['"]?\s*javascript:|-moz-binding)/i;

function isEventAttr(name) {
  return /^on/i.test(name);
}

// Navegadores removem tab/LF/CR (e outros controles ASCII) de qualquer ponto da
// URL antes de interpretar o esquema — então "jav\tascript:" é tratado como
// "javascript:". Removemos esses caracteres só para o teste do esquema; o
// atributo em si não é "limpo", é removido inteiro quando bate com javascript:.
function isJavascriptUrl(value) {
  const cleaned = String(value).replace(/[\x00-\x20\x7f]/g, "");
  return /^javascript:/i.test(cleaned);
}

export function isDangerousStyleValue(value) {
  return DANGEROUS_STYLE_RE.test(String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""));
}

// Regra única de "esse par atributo/valor pode entrar no DOM da página?".
// Usada tanto pelo sanitizador de HTML quanto pelo `setAttr`/`setStyle` de
// lib/ops.js — que antes escreviam direto e deixavam passar `onclick=` e
// `href="javascript:…"`.
export function isSafeAttribute(name, value) {
  const lower = String(name).toLowerCase();
  if (isEventAttr(lower)) return false;
  if (EMBEDDED_DOC_ATTRS.includes(lower)) return false;
  if (URL_ATTRS.includes(lower) && isJavascriptUrl(value)) return false;
  if (lower === "style" && isDangerousStyleValue(value)) return false;
  return true;
}

// Comparação por `localName` minúsculo em vez de seletor de tipo: um seletor
// casa case-insensitive com elementos HTML mas case-sensitive com os do
// namespace SVG (e nem todo motor de seleção respeita essa distinção), então
// `<animateTransform>` escaparia de um `querySelectorAll("animatetransform")`.
const DANGEROUS_LOCAL_NAMES = new Set(DANGEROUS_TAGS.map((t) => t.toLowerCase()));

function stripDangerousElements(root) {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const localName = (el.localName || el.tagName || "").toLowerCase();
    if (DANGEROUS_LOCAL_NAMES.has(localName)) el.remove();
  }
}

export function sanitizeHTML(html, doc) {
  const template = doc.createElement("template");
  template.innerHTML = html;
  const root = template.content;

  stripDangerousElements(root);

  root.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (!isSafeAttribute(attr.name, attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return template.innerHTML;
}
