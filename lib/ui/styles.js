// lib/ui/styles.js — CSS injetado dentro dos shadow roots de <aise-panel> e
// <aise-indicator>. Puro texto: nenhum destes módulos toca `document`/`window`.
// `all: initial` no `.aise-container` isola do CSS do site hospedeiro; tudo
// daqui pra baixo é redefinido explicitamente.

export const BASE_CSS = `
  :host { all: initial; display: block; }
  .aise-container {
    all: initial;
    position: fixed;
    z-index: 2147483647;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    color: #f2f2f2;
    box-sizing: border-box;
  }
  .aise-container, .aise-container * , .aise-container *::before, .aise-container *::after {
    box-sizing: border-box;
  }
  .aise-card {
    background: #1f1f23;
    color: #f2f2f2;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .aise-btn {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 10px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.08);
    color: #f2f2f2;
    font-size: 12px;
    white-space: nowrap;
  }
  .aise-btn:hover { background: rgba(255, 255, 255, 0.16); }
  .aise-btn:disabled { cursor: default; opacity: 0.5; }
  .aise-btn-primary { background: #ee8d49; color: #1f1f23; font-weight: 600; }
  .aise-btn-primary:hover { background: #f19c60; }
  .aise-btn-small { padding: 3px 8px; font-size: 11px; }
  .aise-icon-btn {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    color: #b8b8bd;
  }
  .aise-icon-btn:hover { background: rgba(255, 255, 255, 0.1); color: #f2f2f2; }
  .aise-icon-btn-active, .aise-icon-btn-active:hover { background: #ee8d49; color: #1f1f23; }
`;

export const PANEL_CSS = `
  .aise-panel {
    top: auto;
    right: 16px;
    bottom: 16px;
    left: auto;
    width: 340px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    overflow: hidden;
  }
  .aise-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: move;
    user-select: none;
    margin: -14px -14px 0;
    padding: 14px 14px 0;
  }
  .aise-panel-dragging { opacity: 0.92; }
  .aise-panel-dragging, .aise-panel-dragging * { user-select: none; }
  .aise-panel-title { font-weight: 600; color: #ee8d49; }
  .aise-panel-header-actions { display: flex; gap: 4px; }
  .aise-panel-selection {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .aise-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px 3px 8px;
    border-radius: 999px;
    background: rgba(238, 141, 73, 0.16);
    color: #f2f2f2;
    font-size: 11px;
  }
  .aise-chip-remove {
    all: unset;
    cursor: pointer;
    color: #b8b8bd;
    padding: 0 2px;
  }
  .aise-chip-remove:hover { color: #f2f2f2; }
  .aise-panel-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .aise-panel-form textarea {
    all: unset;
    box-sizing: border-box;
    display: block;
    width: 100%;
    min-height: 60px;
    resize: vertical;
    padding: 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.06);
    color: #f2f2f2;
    font-family: inherit;
    font-size: 13px;
  }
  .aise-panel-form textarea:disabled { opacity: 0.5; }
  .aise-panel-form button[type="submit"] { align-self: flex-end; }
  .aise-panel-busy, .aise-panel-error {
    font-size: 12px;
    padding: 6px 8px;
    border-radius: 6px;
  }
  .aise-panel-busy { background: rgba(255, 255, 255, 0.06); color: #b8b8bd; }
  .aise-panel-error { background: rgba(220, 80, 80, 0.16); color: #ff9d9d; }
  .aise-panel-history {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
  }
  .aise-history-entry {
    padding: 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .aise-history-entry-undone { opacity: 0.55; text-decoration: line-through; }
  .aise-history-head { display: flex; gap: 6px; font-weight: 600; }
  .aise-history-n { color: #ee8d49; }
  .aise-history-summary { color: #d8d8db; }
  .aise-history-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .aise-panel-footer {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .aise-panel-toast {
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: 14px;
    padding: 6px 10px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.7);
    color: #f2f2f2;
    font-size: 12px;
    text-align: center;
  }
`;

export const INDICATOR_CSS = `
  .aise-indicator {
    display: flex;
    padding: 0 16px;
  }
  .aise-indicator-top { top: 0; left: 0; right: 0; padding-top: 12px; align-items: flex-start; }
  .aise-indicator-bottom { bottom: 0; left: 0; right: 0; padding-bottom: 12px; align-items: flex-end; }
  .aise-banner {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px 14px;
    margin: 0 auto;
    max-width: 640px;
  }
  .aise-banner-text { flex: 1 1 auto; min-width: 200px; }
  .aise-banner-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
  .aise-pill {
    all: unset;
    cursor: pointer;
    margin-left: auto;
    margin-right: 4px;
    padding: 6px 12px;
    border-radius: 999px;
    color: #f2f2f2;
    font-size: 12px;
  }
  .aise-pill:hover { background: #2a2a30; }
`;

// Overlay do seletor de elementos (<aise-picker>). `pointer-events: none` em
// tudo: a mira nunca rouba o clique que o picker quer capturar.
export const PICKER_CSS = `
  :host([hidden]) { display: none; }
  .aise-pick-overlay { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
  .aise-pick-box {
    position: fixed;
    box-sizing: border-box;
    border: 2px solid #ee8d49;
    background: rgba(238, 141, 73, 0.16);
    border-radius: 2px;
    pointer-events: none;
  }
  .aise-pick-label {
    position: fixed;
    max-width: 60vw;
    padding: 2px 8px;
    border-radius: 4px;
    background: #1f1f23;
    color: #f2f2f2;
    font: 12px/18px ui-monospace, Menlo, Consolas, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }
  .aise-pick-hint {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    padding: 6px 12px;
    border-radius: 999px;
    background: #1f1f23;
    color: #f2f2f2;
    font: 12px/16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }
  [hidden] { display: none !important; }
`;
