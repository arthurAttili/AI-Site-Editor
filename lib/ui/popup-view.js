// lib/ui/popup-view.js — renderização pura do popup da toolbar (Task 13).
// Módulo ES puro: `doc` entra por injeção, nada de `document`/`window`/
// `chrome`/`console` globais — `popup.js` é quem fala com `chrome.tabs`,
// `chrome.scripting` e `chrome.runtime`; este módulo só sabe desenhar
// estado (da aba atual e dos presets do site) e delegar cliques/mudanças
// para `handlers`.

const WARNING_TEXT =
  "Presets com auto-aplicar ligado mudam o site ao carregar. O banner laranja sempre indica quando você está vendo uma versão modificada.";
const UNREACHABLE_TEXT = "Extensão não carregada nesta aba";

export function createPopupView(doc, root, handlers = {}) {
  root.textContent = "";
  root.innerHTML = `
    <div class="aise-popup">
      <div class="aise-popup-status" data-role="status">Carregando…</div>
      <div class="aise-popup-actions">
        <button type="button" class="aise-btn aise-btn-primary" data-action="pick" disabled>Selecionar elemento</button>
        <button type="button" class="aise-btn" data-action="toggle-original" disabled>Ver original</button>
        <button type="button" class="aise-btn" data-action="undo-all" disabled>Desfazer tudo</button>
      </div>
      <div class="aise-popup-error" data-role="error" hidden></div>
      <div class="aise-popup-busy" data-role="busy" hidden>Aplicando…</div>
      <div class="aise-popup-presets" data-role="presets"></div>
      <div class="aise-popup-warning">${WARNING_TEXT}</div>
      <div class="aise-popup-footer">
        <button type="button" class="aise-popup-link" data-action="options">Opções</button>
      </div>
    </div>
  `;

  const statusEl = root.querySelector('[data-role="status"]');
  const pickBtn = root.querySelector('[data-action="pick"]');
  const toggleBtn = root.querySelector('[data-action="toggle-original"]');
  const undoAllBtn = root.querySelector('[data-action="undo-all"]');
  const errorEl = root.querySelector('[data-role="error"]');
  const busyEl = root.querySelector('[data-role="busy"]');
  const presetsEl = root.querySelector('[data-role="presets"]');

  let currentState; // undefined = ainda não carregado; null = extensão inacessível
  let currentPresets = [];
  let busy = false;

  // Delegação única de cliques por `data-action` — sobrevive a qualquer
  // re-render da lista de presets.
  root.addEventListener("click", (e) => {
    const target = typeof e.target.closest === "function" ? e.target.closest("[data-action]") : null;
    if (!target) return;
    const action = target.getAttribute("data-action");
    const id = target.getAttribute("data-id");
    switch (action) {
      case "pick":
        handlers.onPickElement?.();
        break;
      case "toggle-original":
        handlers.onToggleOriginal?.();
        break;
      case "undo-all":
        handlers.onUndoAll?.();
        break;
      case "apply":
        handlers.onApplyPreset?.(id);
        break;
      case "remove":
        handlers.onRemovePreset?.(id);
        break;
      case "options":
        handlers.onOpenOptions?.();
        break;
      default:
        break;
    }
  });

  // Delegação única de `change` — só a checkbox de auto-aplicar usa isso.
  root.addEventListener("change", (e) => {
    const target = e.target;
    if (!target || target.getAttribute("data-action") !== "auto-apply") return;
    const id = target.getAttribute("data-id");
    handlers.onSetAutoApply?.(id, !!target.checked);
  });

  function renderHeader() {
    if (currentState === null) {
      statusEl.textContent = UNREACHABLE_TEXT;
      toggleBtn.textContent = "Ver original";
      toggleBtn.disabled = true;
      undoAllBtn.disabled = true;
      pickBtn.disabled = true;
      return;
    }
    if (currentState) {
      pickBtn.disabled = false;
      const activeCount = currentState.activeCount || 0;
      const originalMode = !!currentState.originalMode;
      if (originalMode) {
        statusEl.textContent = "Site original";
      } else if (activeCount > 0) {
        statusEl.textContent = `Site modificado por você · ${activeCount} alterações`;
      } else {
        statusEl.textContent = "Sem alterações";
      }
      toggleBtn.textContent = originalMode ? "Ver modificado" : "Ver original";
      toggleBtn.disabled = !originalMode && activeCount === 0;
      undoAllBtn.disabled = activeCount === 0;
    }
    if (busy) {
      pickBtn.disabled = true;
      toggleBtn.disabled = true;
      undoAllBtn.disabled = true;
    }
  }

  function renderPresets() {
    presetsEl.textContent = "";
    if (!currentPresets || currentPresets.length === 0) {
      const empty = doc.createElement("div");
      empty.className = "aise-popup-empty";
      empty.textContent = "Nenhum preset salvo para este site.";
      presetsEl.appendChild(empty);
      return;
    }
    for (const preset of currentPresets) {
      const row = doc.createElement("div");
      row.className = "aise-popup-preset";

      const info = doc.createElement("div");
      info.className = "aise-popup-preset-info";
      const nameEl = doc.createElement("span");
      nameEl.className = "aise-popup-preset-name";
      nameEl.textContent = preset.name;
      const countEl = doc.createElement("span");
      countEl.className = "aise-popup-preset-count";
      countEl.textContent = `${(preset.ops || []).length} alterações`;
      info.appendChild(nameEl);
      info.appendChild(countEl);

      const autoLabel = doc.createElement("label");
      autoLabel.className = "aise-popup-auto";
      const autoCheckbox = doc.createElement("input");
      autoCheckbox.type = "checkbox";
      autoCheckbox.setAttribute("data-action", "auto-apply");
      autoCheckbox.setAttribute("data-id", preset.id);
      autoCheckbox.checked = !!preset.autoApply;
      autoCheckbox.disabled = busy;
      const autoText = doc.createElement("span");
      autoText.textContent = "Auto-aplicar";
      autoLabel.appendChild(autoCheckbox);
      autoLabel.appendChild(autoText);

      const actions = doc.createElement("div");
      actions.className = "aise-popup-preset-actions";

      const applyBtn = doc.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "aise-btn aise-btn-small";
      applyBtn.setAttribute("data-action", "apply");
      applyBtn.setAttribute("data-id", preset.id);
      applyBtn.textContent = "Aplicar agora";
      applyBtn.disabled = busy;

      const removeBtn = doc.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "aise-btn aise-btn-small";
      removeBtn.setAttribute("data-action", "remove");
      removeBtn.setAttribute("data-id", preset.id);
      removeBtn.textContent = "Remover";
      removeBtn.disabled = busy;

      actions.appendChild(applyBtn);
      actions.appendChild(removeBtn);

      row.appendChild(info);
      row.appendChild(autoLabel);
      row.appendChild(actions);
      presetsEl.appendChild(row);
    }
  }

  function setUneditable(msg) {
    root.textContent = "";
    const notice = doc.createElement("div");
    notice.className = "aise-popup-uneditable";
    notice.textContent = msg;
    root.appendChild(notice);
  }

  function setState(state) {
    currentState = state === null ? null : state || undefined;
    renderHeader();
  }

  function setPresets(presets) {
    currentPresets = presets || [];
    renderPresets();
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

  function setBusy(isBusy) {
    busy = !!isBusy;
    busyEl.hidden = !busy;
    renderHeader();
    renderPresets();
  }

  return { setUneditable, setState, setPresets, setError, setBusy };
}
