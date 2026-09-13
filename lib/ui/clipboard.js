// lib/ui/clipboard.js — copia texto para a área de transferência.
// Módulo ES puro: `clipboard` (normalmente `navigator.clipboard`) e `doc`
// entram por injeção. Tenta a API assíncrona e, se ela falhar (página sem
// foco, contexto sem permissão, DevTools), cai no `execCommand("copy")` com
// um textarea temporário.

export async function copyText(text, { clipboard, doc } = {}) {
  const value = text == null ? "" : String(text);
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // cai no fallback
    }
  }
  if (doc && typeof doc.execCommand === "function") {
    const ta = doc.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    (doc.body || doc.documentElement).appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = doc.execCommand("copy") === true;
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
  return false;
}
