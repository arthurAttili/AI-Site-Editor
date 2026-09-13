// lib/sanitize.js — sanitiza HTML antes de inserir no DOM da página alvo.
// Módulo ES puro: nada de `document`/`window`/`chrome` globais — tudo entra via `doc`.

const DANGEROUS_TAGS = ["script", "iframe", "object", "embed"];
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href"];

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

export function sanitizeHTML(html, doc) {
  const template = doc.createElement("template");
  template.innerHTML = html;
  const root = template.content;

  for (const tag of DANGEROUS_TAGS) {
    root.querySelectorAll(tag).forEach((el) => el.remove());
  }

  root.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      if (isEventAttr(name)) {
        el.removeAttribute(name);
        continue;
      }
      if (URL_ATTRS.includes(name.toLowerCase()) && isJavascriptUrl(attr.value)) {
        el.removeAttribute(name);
      }
    }
  });

  return template.innerHTML;
}
