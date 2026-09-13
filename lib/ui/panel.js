// lib/ui/panel.js — painel flutuante "Editor IA" em Shadow DOM.
// Módulo ES puro: `doc` entra por injeção, nada de `document`/`window`/
// `chrome`/`console` globais. Quando precisa da window, usa `doc.defaultView`.

import { BASE_CSS, PANEL_CSS } from "./styles.js";

const PANEL_WIDTH = 340;
const PANEL_HEIGHT = 420;
const VIEWPORT_MARGIN = 12;
const TOAST_DURATION_MS = 2500;
const DEFAULT_BUSY_TEXT = "Pensando…";

export function createPanel(doc, handlers = {}) {
  // Idempotência: uma segunda chamada substitui o host existente em vez de
  // empilhar dois <aise-panel>.
  const existing = doc.querySelector("aise-panel");
  if (existing) existing.remove();

  const host = doc.createElement("aise-panel");
  doc.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = doc.createElement("style");
  style.textContent = BASE_CSS + PANEL_CSS;
  shadow.appendChild(style);

  const container = doc.createElement("div");
  container.className = "aise-container aise-card aise-panel";
  container.style.display = "none";
  container.innerHTML = `
    <div class="aise-panel-header">
      <span class="aise-panel-title">Editor IA</span>
      <div class="aise-panel-header-actions">
        <button type="button" class="aise-icon-btn" data-action="pick" aria-label="Selecionar elemento" title="Selecionar elemento na página (como o inspetor do F12)" aria-pressed="false">⌖</button>
        <button type="button" class="aise-icon-btn" data-action="options" aria-label="Opções">⚙</button>
        <button type="button" class="aise-icon-btn" data-action="close" aria-label="Fechar">×</button>
      </div>
    </div>
    <div class="aise-panel-selection" data-role="selection"></div>
    <form class="aise-panel-form">
      <textarea placeholder="O que você quer mudar? Ex.: deixe o botão vermelho e maior"></textarea>
      <button type="submit" class="aise-btn aise-btn-primary">Aplicar</button>
    </form>
    <div class="aise-panel-busy" data-role="busy" hidden></div>
    <div class="aise-panel-error" data-role="error" hidden></div>
    <div class="aise-panel-history" data-role="history"></div>
    <div class="aise-panel-footer">
      <button type="button" class="aise-btn" data-action="undo-all">Desfazer tudo</button>
      <button type="button" class="aise-btn" data-action="redo-all">Refazer tudo</button>
      <button type="button" class="aise-btn" data-action="save-preset">Salvar preset deste site</button>
    </div>
    <div class="aise-panel-toast" data-role="toast" hidden></div>
  `;
  shadow.appendChild(container);

  const selectionEl = container.querySelector('[data-role="selection"]');
  const form = container.querySelector("form");
  const textarea = container.querySelector("textarea");
  const submitBtn = container.querySelector('button[type="submit"]');
  const busyEl = container.querySelector('[data-role="busy"]');
  const pickBtn = container.querySelector('[data-action="pick"]');
  const errorEl = container.querySelector('[data-role="error"]');
  const historyEl = container.querySelector('[data-role="history"]');
  const toastEl = container.querySelector('[data-role="toast"]');

  let isOpenFlag = false;
  let toastTimer = null;
  let busyFlag = false;
  let originalModeFlag = false;

  // Enviar e "ocupado" desabilitam o mesmo botão por motivos diferentes; um
  // ponto único evita que `setBusy(false)` reabilite o envio enquanto o modo
  // original ainda está ligado.
  function syncSubmitEnabled() {
    submitBtn.disabled = busyFlag || originalModeFlag;
    textarea.disabled = busyFlag;
  }

  function submitCurrentValue() {
    const value = textarea.value.trim();
    if (!value) return;
    handlers.onSubmit?.(value);
    textarea.value = "";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitCurrentValue();
  });

  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      submitCurrentValue();
    }
  });

  shadow.addEventListener("keydown", (e) => {
    if (e.key === "Escape") handlers.onClose?.();
  });

  // Delegação única de cliques por `data-action` — sobrevive a qualquer
  // re-render de chip/histórico.
  shadow.addEventListener("click", (e) => {
    const target = typeof e.target.closest === "function" ? e.target.closest("[data-action]") : null;
    if (!target) return;
    const action = target.getAttribute("data-action");
    const id = target.getAttribute("data-id");
    switch (action) {
      case "close":
        handlers.onClose?.();
        break;
      case "options":
        handlers.onOpenOptions?.();
        break;
      case "pick":
        handlers.onTogglePicker?.();
        break;
      case "remove-selection":
        handlers.onRemoveSelection?.(id);
        break;
      case "undo":
        handlers.onUndo?.(id);
        break;
      case "undo-all":
        handlers.onUndoAll?.();
        break;
      case "redo-all":
        handlers.onRedoAll?.();
        break;
      case "save-preset":
        handlers.onSavePreset?.();
        break;
      default:
        break;
    }
  });

  function setSelection(list = []) {
    selectionEl.innerHTML = "";
    for (const item of list) {
      const chip = doc.createElement("span");
      chip.className = "aise-chip";

      const label = doc.createElement("span");
      label.className = "aise-chip-label";
      label.textContent = item.label;

      const removeBtn = doc.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "aise-chip-remove";
      removeBtn.setAttribute("data-action", "remove-selection");
      removeBtn.setAttribute("data-id", item.id);
      removeBtn.setAttribute("aria-label", "Remover seleção");
      removeBtn.textContent = "×";

      chip.appendChild(label);
      chip.appendChild(removeBtn);
      selectionEl.appendChild(chip);
    }
  }

  function setBusy(isBusy, text = DEFAULT_BUSY_TEXT) {
    busyFlag = !!isBusy;
    busyEl.hidden = !isBusy;
    busyEl.textContent = isBusy ? text : "";
    syncSubmitEnabled();
  }

  // O content script desliga o envio enquanto o modo original está ligado —
  // um pedido aplicado sobre o DOM revertido seria reaplicado de novo na saída.
  function setOriginalMode(on) {
    originalModeFlag = !!on;
    submitBtn.title = originalModeFlag ? "Saia do modo original para editar." : "";
    syncSubmitEnabled();
  }

  // Estado visual do botão de mira: o content script liga/desliga o picker e
  // reflete aqui (aria-pressed + classe) — o painel não sabe se há picker.
  function setPicking(on) {
    pickBtn.setAttribute("aria-pressed", on ? "true" : "false");
    pickBtn.classList.toggle("aise-icon-btn-active", !!on);
  }

  function setHistory(list = []) {
    historyEl.innerHTML = "";
    for (const item of list) {
      const entry = doc.createElement("div");
      entry.className = "aise-history-entry" + (item.undone ? " aise-history-entry-undone" : "");

      const head = doc.createElement("div");
      head.className = "aise-history-head";
      const numSpan = doc.createElement("span");
      numSpan.className = "aise-history-n";
      numSpan.textContent = `#${item.n}`;
      const reqSpan = doc.createElement("span");
      reqSpan.className = "aise-history-request";
      reqSpan.textContent = item.request;
      head.appendChild(numSpan);
      head.appendChild(reqSpan);

      const summary = doc.createElement("div");
      summary.className = "aise-history-summary";
      summary.textContent = item.summary;

      const meta = doc.createElement("div");
      meta.className = "aise-history-meta";
      const opsSpan = doc.createElement("span");
      opsSpan.className = "aise-history-ops";
      opsSpan.textContent = `${item.opsCount} alterações`;

      const undoBtn = doc.createElement("button");
      undoBtn.type = "button";
      undoBtn.className = "aise-btn aise-btn-small";
      undoBtn.setAttribute("data-action", "undo");
      undoBtn.setAttribute("data-id", item.id);
      if (item.undone) {
        undoBtn.textContent = "Desfeito";
        undoBtn.disabled = true;
      } else {
        undoBtn.textContent = "Desfazer";
      }

      meta.appendChild(opsSpan);
      meta.appendChild(undoBtn);

      entry.appendChild(head);
      entry.appendChild(summary);
      entry.appendChild(meta);
      historyEl.appendChild(entry);
    }
  }

  function setError(msg) {
    if (msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    } else {
      errorEl.textContent = "";
      errorEl.hidden = true;
    }
  }

  function toast(msg) {
    const win = doc.defaultView;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    if (toastTimer) win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => {
      toastEl.hidden = true;
      toastEl.textContent = "";
      toastTimer = null;
    }, TOAST_DURATION_MS);
  }

  function focus() {
    textarea.focus();
  }

  function show(anchorRect) {
    const win = doc.defaultView;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    let left;
    let top;
    if (anchorRect) {
      left = anchorRect.left;
      top = anchorRect.bottom + 8;
    } else {
      left = vw - PANEL_WIDTH - VIEWPORT_MARGIN;
      top = vh - PANEL_HEIGHT - VIEWPORT_MARGIN;
    }
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vw - PANEL_WIDTH - VIEWPORT_MARGIN));
    top = Math.min(Math.max(top, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vh - PANEL_HEIGHT - VIEWPORT_MARGIN));
    container.style.left = `${left}px`;
    container.style.top = `${top}px`;
    container.style.right = "auto";
    container.style.bottom = "auto";
    container.style.display = "flex";
    isOpenFlag = true;
  }

  function hide() {
    // O toast é filho do container escondido: sem cancelar o timer, ele
    // dispararia com o painel fechado e reapareceria na próxima abertura.
    const win = doc.defaultView;
    if (toastTimer) {
      win.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastEl.hidden = true;
    toastEl.textContent = "";
    container.style.display = "none";
    isOpenFlag = false;
  }

  function isOpen() {
    return isOpenFlag;
  }

  return {
    show,
    hide,
    isOpen,
    setSelection,
    setBusy,
    setOriginalMode,
    setPicking,
    setHistory,
    setError,
    toast,
    focus,
  };
}
