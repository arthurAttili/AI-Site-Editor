// lib/ui/indicator.js — banner/pílula "site modificado" em Shadow DOM.
// Módulo ES puro: `doc` entra por injeção, nada de `document`/`window`/
// `chrome`/`console` globais.
//
// Não existe estado "escondido": sempre que `activeCount > 0 || originalMode`
// o host mostra banner (padrão) ou pílula (depois de "Minimizar"); caso
// contrário o host é removido do DOM inteiramente.

import { BASE_CSS, INDICATOR_CSS } from "./styles.js";

export function createIndicator(doc, { position = "bottom", onViewOriginal, onEdit, onDisableAuto } = {}) {
  let pos = position;
  let minimized = false;
  let host = null;
  let shadow = null;
  let container = null;
  let state = {
    activeCount: 0,
    originalMode: false,
    presetNames: [],
    fromPreset: false,
    autoApplied: false,
    applied: 0,
    total: 0,
  };

  function bannerText(s) {
    if (s.originalMode) {
      return `Você está vendo o site ORIGINAL (${s.total} alterações suas desligadas)`;
    }
    const names = Array.isArray(s.presetNames) ? s.presetNames.filter(Boolean) : [];
    const presetPart = names.length > 0 ? ` — preset '${names.join(", ")}'` : "";
    return `⚠ Você está vendo uma versão MODIFICADA por você deste site${presetPart} (${s.activeCount} alterações). Não é o site original.`;
  }

  function pillText(s) {
    if (s.originalMode) {
      return `Site ORIGINAL · ${s.total} desligadas`;
    }
    return `✎ Modificado por você · ${s.activeCount}`;
  }

  function buildBanner(s) {
    const banner = doc.createElement("div");
    banner.className = "aise-card aise-banner";

    const text = doc.createElement("span");
    text.className = "aise-banner-text";
    text.textContent = bannerText(s);
    banner.appendChild(text);

    const actions = doc.createElement("div");
    actions.className = "aise-banner-actions";

    const viewBtn = doc.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "aise-btn";
    viewBtn.setAttribute("data-action", "view-original");
    viewBtn.textContent = s.originalMode ? "Ver modificado" : "Ver original";
    actions.appendChild(viewBtn);

    const editBtn = doc.createElement("button");
    editBtn.type = "button";
    editBtn.className = "aise-btn";
    editBtn.setAttribute("data-action", "edit");
    editBtn.textContent = "Editar";
    actions.appendChild(editBtn);

    // Só faz sentido oferecer "Desligar auto-aplicar" quando algum preset
    // aplicado veio realmente do auto-aplicar do carregamento da página —
    // um preset aplicado à mão pelo popup não tem auto-aplicar a desligar.
    if (s.autoApplied) {
      const disableBtn = doc.createElement("button");
      disableBtn.type = "button";
      disableBtn.className = "aise-btn";
      disableBtn.setAttribute("data-action", "disable-auto");
      disableBtn.textContent = "Desligar auto-aplicar";
      actions.appendChild(disableBtn);
    }

    const minBtn = doc.createElement("button");
    minBtn.type = "button";
    minBtn.className = "aise-btn";
    minBtn.setAttribute("data-action", "minimize");
    minBtn.textContent = "Minimizar";
    actions.appendChild(minBtn);

    banner.appendChild(actions);
    return banner;
  }

  function buildPill(s) {
    const pill = doc.createElement("button");
    pill.type = "button";
    pill.className = "aise-card aise-pill";
    pill.setAttribute("data-action", "expand");
    pill.textContent = pillText(s);
    return pill;
  }

  function applyDock() {
    if (!container) return;
    container.classList.toggle("aise-indicator-top", pos === "top");
    container.classList.toggle("aise-indicator-bottom", pos !== "top");
  }

  function ensureHost() {
    if (host) return;
    // Defensivo: nunca deixa dois <aise-indicator> convivendo no doc.
    const stray = doc.querySelector("aise-indicator");
    if (stray) stray.remove();

    host = doc.createElement("aise-indicator");
    doc.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });

    const style = doc.createElement("style");
    style.textContent = BASE_CSS + INDICATOR_CSS;
    shadow.appendChild(style);

    container = doc.createElement("div");
    container.className = "aise-container aise-indicator";
    shadow.appendChild(container);

    shadow.addEventListener("click", (e) => {
      const target = typeof e.target.closest === "function" ? e.target.closest("[data-action]") : null;
      if (!target) return;
      const action = target.getAttribute("data-action");
      switch (action) {
        case "view-original":
          onViewOriginal?.();
          break;
        case "edit":
          onEdit?.();
          break;
        case "disable-auto":
          onDisableAuto?.();
          break;
        case "minimize":
          minimized = true;
          render();
          break;
        case "expand":
          minimized = false;
          render();
          break;
        default:
          break;
      }
    });
  }

  function destroyHost() {
    if (host) host.remove();
    host = null;
    shadow = null;
    container = null;
  }

  function render() {
    const shouldShow = state.activeCount > 0 || state.originalMode;
    if (!shouldShow) {
      destroyHost();
      return;
    }
    ensureHost();
    applyDock();
    container.innerHTML = "";
    container.appendChild(minimized ? buildPill(state) : buildBanner(state));
  }

  function update(next) {
    state = { ...state, ...next };
    render();
  }

  function setPosition(newPos) {
    pos = newPos;
    applyDock();
  }

  function destroy() {
    destroyHost();
  }

  return { update, setPosition, destroy };
}
