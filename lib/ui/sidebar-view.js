// lib/ui/sidebar-view.js — renderização pura da sidebar "Editor IA" (aba
// Elements do DevTools). Módulo ES puro: `doc` entra por injeção, nada de
// `document`/`window`/`chrome`/`console` globais — `sidebar.js` é quem fala
// com a porta do background e com `chrome.devtools.*`; este módulo só sabe
// desenhar estado e delegar cliques para `handlers`.

const CONNECTION_TEXT = {
  ok: "Conectado",
  disconnected: "Desconectado — reabra o DevTools",
  "no-content": "Extensão não carregada nesta aba — clique com o botão direito na página e escolha 'Editar com IA'.",
};

export function createSidebarView(doc, root, handlers = {}) {
  root.textContent = "";
  root.innerHTML = `
    <div class="aise-sidebar">
      <div class="aise-connection" data-role="connection"></div>
      <div class="aise-inspected-row">
        <span class="aise-inspected-label" data-role="inspected">Selecionado: nenhum</span>
        <button type="button" class="aise-btn aise-btn-small" data-action="use-selected" disabled>Usar elemento selecionado</button>
      </div>
      <div class="aise-selection-chips" data-role="selection"></div>
      <div class="aise-form">
        <textarea data-role="input" placeholder="O que você quer mudar? Ex.: deixe o botão vermelho e maior"></textarea>
        <button type="button" class="aise-btn aise-btn-primary" data-action="send">Enviar</button>
      </div>
      <div class="aise-busy" data-role="busy" hidden>Aplicando…</div>
      <div class="aise-error" data-role="error" hidden></div>
      <div class="aise-status" data-role="status">Sem alterações</div>
      <div class="aise-history" data-role="history"></div>
      <div class="aise-footer">
        <button type="button" class="aise-btn" data-action="undo-all">Desfazer tudo</button>
        <button type="button" class="aise-btn" data-action="redo-all">Refazer tudo</button>
        <button type="button" class="aise-btn" data-action="view-original">Ver original</button>
        <button type="button" class="aise-btn" data-action="save-preset">Salvar preset</button>
        <button type="button" class="aise-btn" data-action="open-options">Abrir opções</button>
      </div>
    </div>
  `;

  const connectionEl = root.querySelector('[data-role="connection"]');
  const inspectedEl = root.querySelector('[data-role="inspected"]');
  const useSelectedBtn = root.querySelector('[data-action="use-selected"]');
  const selectionEl = root.querySelector('[data-role="selection"]');
  const textarea = root.querySelector('[data-role="input"]');
  const sendBtn = root.querySelector('[data-action="send"]');
  const busyEl = root.querySelector('[data-role="busy"]');
  const errorEl = root.querySelector('[data-role="error"]');
  const statusEl = root.querySelector('[data-role="status"]');
  const historyEl = root.querySelector('[data-role="history"]');
  const viewOriginalBtn = root.querySelector('[data-action="view-original"]');

  function sendCurrentValue() {
    const value = textarea.value.trim();
    if (!value) return;
    handlers.onSend?.(value);
    textarea.value = "";
  }

  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendCurrentValue();
    }
  });

  // Delegação única de cliques por `data-action` — sobrevive a qualquer
  // re-render de chip/histórico.
  root.addEventListener("click", (e) => {
    const target = typeof e.target.closest === "function" ? e.target.closest("[data-action]") : null;
    if (!target) return;
    const action = target.getAttribute("data-action");
    const id = target.getAttribute("data-id");
    switch (action) {
      case "send":
        sendCurrentValue();
        break;
      case "use-selected":
        handlers.onUseSelected?.();
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
      case "view-original":
        handlers.onViewOriginal?.();
        break;
      case "save-preset":
        handlers.onSavePreset?.();
        break;
      case "open-options":
        handlers.onOpenOptions?.();
        break;
      default:
        break;
    }
  });

  function setInspected(label) {
    inspectedEl.textContent = label ? `Selecionado: ${label}` : "Selecionado: nenhum";
    useSelectedBtn.disabled = !label;
  }

  function renderSelection(list = []) {
    selectionEl.textContent = "";
    for (const item of list) {
      const chip = doc.createElement("span");
      chip.className = "aise-chip";
      chip.textContent = item.label;
      selectionEl.appendChild(chip);
    }
  }

  // Mesma fórmula de `content.js#refresh()`: soma das ops ainda ativas no
  // histórico mais as ops dos presets aplicados — é o número de alterações
  // que o modo original está segurando desligadas.
  function disabledTotal(state) {
    const historySum = (state.history || []).filter((h) => !h.undone).reduce((sum, h) => sum + h.opsCount, 0);
    const presetSum = (state.presetsApplied || []).reduce((sum, p) => sum + p.total, 0);
    return historySum + presetSum;
  }

  function statusText(state) {
    if (state.originalMode) return `Site ORIGINAL · ${disabledTotal(state)} desligadas`;
    if (state.activeCount > 0) return `Site MODIFICADO por você · ${state.activeCount} alterações`;
    return "Sem alterações";
  }

  function renderHistory(list = []) {
    historyEl.textContent = "";
    const newestFirst = list.slice().reverse();
    for (const item of newestFirst) {
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

  function setState(state = {}) {
    renderSelection(state.selection);
    statusEl.textContent = statusText(state);
    renderHistory(state.history);
    viewOriginalBtn.textContent = state.originalMode ? "Ver modificado" : "Ver original";
  }

  function setBusy(isBusy) {
    busyEl.hidden = !isBusy;
    textarea.disabled = isBusy;
    sendBtn.disabled = isBusy;
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

  function setConnection(status) {
    connectionEl.textContent = CONNECTION_TEXT[status] || "";
  }

  return { setInspected, setState, setBusy, setError, setConnection };
}
