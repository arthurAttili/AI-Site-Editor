// lib/ui/picker.js — seletor de elementos "estilo F12": enquanto ativo, o
// ponteiro vira uma mira; o elemento sob o mouse ganha um contorno com rótulo
// e um clique o entrega ao chamador. Módulo puro: recebe `doc` e handlers,
// nunca toca `chrome.*` nem o estado da sessão.
//
//   const picker = createPicker(doc, { onPick(el, { additive }), onCancel() });
//   picker.start(); picker.stop(); picker.isActive();
//
// Clique simples → onPick(el, { additive: false }) e o picker se desliga (como
// o inspetor do DevTools). Shift+clique → onPick(el, { additive: true }) e o
// picker continua ligado para juntar mais elementos. Esc → onCancel().
// Eventos sobre a própria UI da extensão (<aise-*>) passam intactos.

import { BASE_CSS, PICKER_CSS } from "./styles.js";

const HOST_TAG = "aise-picker";
const PICKING_ATTR = "data-aise-picking";
const UI_HOSTS = "aise-panel, aise-indicator, aise-picker";
const CURSOR_STYLE_ATTR = "data-aise-picker-cursor";
// A mira precisa vencer qualquer `cursor` do site; o atributo no <html> é o
// interruptor, o <style> só existe enquanto o picker está ligado.
const CURSOR_CSS = `[${PICKING_ATTR}], [${PICKING_ATTR}] * { cursor: crosshair !important; }`;

export function createPicker(doc, handlers = {}) {
  let host = null;
  let box = null;
  let label = null;
  let active = false;
  let hovered = null;

  function ensureHost() {
    if (host && host.isConnected) return;
    host = doc.querySelector(HOST_TAG) || doc.createElement(HOST_TAG);
    if (!host.shadowRoot) {
      const shadow = host.attachShadow({ mode: "open" });
      const style = doc.createElement("style");
      style.textContent = BASE_CSS + PICKER_CSS;
      shadow.appendChild(style);
      const overlay = doc.createElement("div");
      overlay.className = "aise-pick-overlay";
      overlay.innerHTML = `
        <div class="aise-pick-box" data-role="box" hidden></div>
        <div class="aise-pick-label" data-role="label" hidden></div>
        <div class="aise-pick-hint">Clique: seleciona · Shift+clique: adiciona à seleção · Esc: cancela</div>
      `;
      shadow.appendChild(overlay);
    }
    box = host.shadowRoot.querySelector('[data-role="box"]');
    label = host.shadowRoot.querySelector('[data-role="label"]');
    if (!host.isConnected) doc.documentElement.appendChild(host);
  }

  function setCursorStyle(on) {
    const existing = doc.querySelector(`style[${CURSOR_STYLE_ATTR}]`);
    if (on && !existing) {
      const style = doc.createElement("style");
      style.setAttribute(CURSOR_STYLE_ATTR, "");
      style.textContent = CURSOR_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    } else if (!on && existing) {
      existing.remove();
    }
  }

  function isUiTarget(target) {
    return !!target && typeof target.closest === "function" && !!target.closest(UI_HOSTS);
  }

  function describe(el) {
    let text = el.tagName ? el.tagName.toLowerCase() : "?";
    if (el.id) text += `#${el.id}`;
    const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (classes.length) text += "." + classes.join(".");
    return text;
  }

  function highlight(el) {
    hovered = el;
    if (!el || typeof el.getBoundingClientRect !== "function") {
      box.hidden = true;
      label.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    label.hidden = false;
    label.textContent = `${describe(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    // Rótulo acima do elemento; se não couber, dentro dele no topo.
    const above = r.top - 24;
    label.style.left = `${Math.max(0, r.left)}px`;
    label.style.top = `${above >= 0 ? above : r.top + 2}px`;
  }

  function onMove(e) {
    if (isUiTarget(e.target)) return;
    if (e.target === doc.documentElement || e.target === doc.body) {
      highlight(null);
      return;
    }
    highlight(e.target);
  }

  function swallow(e) {
    if (isUiTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (isUiTarget(e.target)) return;
    swallow(e);
    const el = e.target;
    if (!el || el === doc.documentElement) return;
    const additive = !!e.shiftKey;
    if (!additive) stop();
    handlers.onPick?.(el, { additive });
  }

  function onKey(e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    stop();
    handlers.onCancel?.();
  }

  function onScroll() {
    if (hovered) highlight(hovered);
  }

  const listeners = [
    ["mousemove", onMove],
    ["pointerdown", swallow],
    ["mousedown", swallow],
    ["pointerup", swallow],
    ["mouseup", swallow],
    ["click", onClick],
    ["keydown", onKey],
    ["scroll", onScroll],
  ];

  function start() {
    if (active) return;
    ensureHost();
    active = true;
    host.hidden = false;
    doc.documentElement.setAttribute(PICKING_ATTR, "");
    setCursorStyle(true);
    for (const [type, fn] of listeners) doc.addEventListener(type, fn, true);
  }

  function stop() {
    if (!active) return;
    active = false;
    for (const [type, fn] of listeners) doc.removeEventListener(type, fn, true);
    doc.documentElement.removeAttribute(PICKING_ATTR);
    setCursorStyle(false);
    highlight(null);
    if (host) host.hidden = true;
  }

  function isActive() {
    return active;
  }

  return { start, stop, isActive };
}
