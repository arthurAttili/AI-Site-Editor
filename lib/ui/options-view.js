// lib/ui/options-view.js — renderização pura da página de Opções (Task 14).
// Módulo ES puro: `doc` entra por injeção, nada de `document`/`window`/
// `chrome`/`console` globais — `options.js` é quem fala com `chrome.storage`
// e `chrome.runtime`; este módulo só desenha o formulário de configurações
// e delegra cliques/mudanças para `handlers`.

import { PROVIDERS, COMPAT_PRESETS } from "../providers/index.js";

// Esqueleto estático (nenhuma string dinâmica é interpolada aqui — as
// opções vindas de PROVIDERS/COMPAT_PRESETS são adicionadas depois via
// createElement, como popup-view.js faz para a lista de presets).
const TEMPLATE = `
  <div class="aise-options">
    <h1 class="aise-options-title">aiSiteEditor — Opções</h1>

    <div class="aise-field">
      <label for="aise-provider">Provedor</label>
      <select id="aise-provider" data-field="provider"></select>
    </div>

    <section class="aise-provider-section" data-provider="claude">
      <h2>Claude (Anthropic)</h2>
      <div class="aise-field">
        <label>Chave de API</label>
        <div class="aise-key-row">
          <input type="password" data-field="providers.claude.apiKey" autocomplete="off" />
          <button type="button" class="aise-btn" data-action="toggle-key">Mostrar</button>
        </div>
      </div>
      <div class="aise-field">
        <label>Modelo</label>
        <input type="text" data-field="providers.claude.model" placeholder="claude-opus-5" />
      </div>
      <div class="aise-test-row">
        <button type="button" class="aise-btn" data-action="test">Testar conexão</button>
        <span class="aise-test-result" data-role="test-result"></span>
      </div>
    </section>

    <section class="aise-provider-section" data-provider="gemini">
      <h2>Gemini (Google)</h2>
      <div class="aise-field">
        <label>Chave de API</label>
        <div class="aise-key-row">
          <input type="password" data-field="providers.gemini.apiKey" autocomplete="off" />
          <button type="button" class="aise-btn" data-action="toggle-key">Mostrar</button>
        </div>
      </div>
      <div class="aise-field">
        <label>Modelo</label>
        <input type="text" data-field="providers.gemini.model" />
      </div>
      <div class="aise-test-row">
        <button type="button" class="aise-btn" data-action="test">Testar conexão</button>
        <span class="aise-test-result" data-role="test-result"></span>
      </div>
    </section>

    <section class="aise-provider-section" data-provider="openai">
      <h2>OpenAI</h2>
      <div class="aise-field">
        <label>Chave de API</label>
        <div class="aise-key-row">
          <input type="password" data-field="providers.openai.apiKey" autocomplete="off" />
          <button type="button" class="aise-btn" data-action="toggle-key">Mostrar</button>
        </div>
      </div>
      <div class="aise-field">
        <label>Modelo</label>
        <input type="text" data-field="providers.openai.model" list="aise-models" />
      </div>
      <div class="aise-test-row">
        <button type="button" class="aise-btn" data-action="test">Testar conexão</button>
        <span class="aise-test-result" data-role="test-result"></span>
      </div>
    </section>

    <section class="aise-provider-section" data-provider="compat">
      <h2>Compatível com OpenAI</h2>
      <div class="aise-field">
        <label>Atalho</label>
        <select data-field="compat.presetId"></select>
      </div>
      <div class="aise-field">
        <label>URL base</label>
        <input type="text" data-field="providers.compat.baseUrl" />
      </div>
      <div class="aise-field">
        <label>Chave de API</label>
        <div class="aise-key-row">
          <input type="password" data-field="providers.compat.apiKey" autocomplete="off" />
          <button type="button" class="aise-btn" data-action="toggle-key">Mostrar</button>
          <span class="aise-nokey" data-role="compat-no-key" hidden>sem chave</span>
        </div>
      </div>
      <div class="aise-field">
        <label>Modelo</label>
        <input type="text" data-field="providers.compat.model" list="aise-models" />
      </div>
      <div class="aise-field">
        <button type="button" class="aise-btn" data-action="list-models">Listar modelos</button>
      </div>
      <div class="aise-test-row">
        <button type="button" class="aise-btn" data-action="test">Testar conexão</button>
        <span class="aise-test-result" data-role="test-result"></span>
      </div>
    </section>

    <datalist id="aise-models"></datalist>

    <div class="aise-field">
      <label>Idioma das respostas</label>
      <input type="text" data-field="language" />
    </div>

    <div class="aise-field">
      <label>Posição do aviso</label>
      <select data-field="indicatorPosition">
        <option value="bottom">Rodapé</option>
        <option value="top">Topo</option>
      </select>
    </div>

    <div class="aise-save-row">
      <button type="button" class="aise-btn aise-btn-primary" data-action="save">Salvar</button>
    </div>

    <div class="aise-toast" data-role="toast" hidden></div>
  </div>
`;

const TOAST_HIDE_MS = 3000;

export function createOptionsView(doc, root, handlers = {}) {
  root.textContent = "";
  root.innerHTML = TEMPLATE;

  const providerSelect = root.querySelector('[data-field="provider"]');
  const compatPresetSelect = root.querySelector('[data-field="compat.presetId"]');
  const sectionEls = Array.from(root.querySelectorAll(".aise-provider-section"));
  const noKeyEl = root.querySelector('[data-role="compat-no-key"]');
  const datalistEl = root.querySelector("#aise-models");
  const toastEl = root.querySelector('[data-role="toast"]');
  const testResultEls = Array.from(root.querySelectorAll('[data-role="test-result"]'));
  const busyButtons = Array.from(
    root.querySelectorAll('[data-action="save"], [data-action="test"], [data-action="list-models"]')
  );

  // Cada campo de texto/senha/select é lido/escrito diretamente pelo path
  // que espelha o shape de `DEFAULT_SETTINGS` (lib/storage.js) — exceto o
  // atalho do compatível, que usa `compat.presetId` por ser um controle de
  // conveniência (preenche baseUrl/model), mas ainda mapeia para
  // `providers.compat.presetId` no objeto de saída.
  const fieldEls = {
    provider: providerSelect,
    language: root.querySelector('[data-field="language"]'),
    indicatorPosition: root.querySelector('[data-field="indicatorPosition"]'),
    "providers.claude.apiKey": root.querySelector('[data-field="providers.claude.apiKey"]'),
    "providers.claude.model": root.querySelector('[data-field="providers.claude.model"]'),
    "providers.gemini.apiKey": root.querySelector('[data-field="providers.gemini.apiKey"]'),
    "providers.gemini.model": root.querySelector('[data-field="providers.gemini.model"]'),
    "providers.openai.apiKey": root.querySelector('[data-field="providers.openai.apiKey"]'),
    "providers.openai.model": root.querySelector('[data-field="providers.openai.model"]'),
    "compat.presetId": compatPresetSelect,
    "providers.compat.baseUrl": root.querySelector('[data-field="providers.compat.baseUrl"]'),
    "providers.compat.apiKey": root.querySelector('[data-field="providers.compat.apiKey"]'),
    "providers.compat.model": root.querySelector('[data-field="providers.compat.model"]'),
  };

  let toastTimer = null;

  // Opções do <select> de provedor, na ordem declarada em PROVIDERS.
  for (const id of Object.keys(PROVIDERS)) {
    const opt = doc.createElement("option");
    opt.value = id;
    opt.textContent = PROVIDERS[id].label;
    providerSelect.appendChild(opt);
  }

  // Atalhos do provedor compatível com OpenAI.
  for (const preset of COMPAT_PRESETS) {
    const opt = doc.createElement("option");
    opt.value = preset.id;
    opt.textContent = preset.label;
    compatPresetSelect.appendChild(opt);
  }

  function updateProviderVisibility() {
    const current = providerSelect.value;
    for (const section of sectionEls) {
      section.hidden = section.getAttribute("data-provider") !== current;
    }
  }

  function updateCompatNoKeyDisplay() {
    const preset = COMPAT_PRESETS.find((p) => p.id === compatPresetSelect.value);
    const needsKey = preset ? preset.needsKey !== false : true;
    noKeyEl.hidden = needsKey;
  }

  // Delegação única de cliques por `data-action` — sobrevive a qualquer
  // re-render (setModels, setTestResult, etc. nunca recriam o DOM).
  root.addEventListener("click", (e) => {
    const target = typeof e.target.closest === "function" ? e.target.closest("[data-action]") : null;
    if (!target) return;
    const action = target.getAttribute("data-action");
    switch (action) {
      case "toggle-key": {
        const row = target.closest(".aise-key-row");
        const input = row && row.querySelector("input");
        if (!input) break;
        input.type = input.type === "password" ? "text" : "password";
        target.textContent = input.type === "text" ? "Ocultar" : "Mostrar";
        break;
      }
      case "test":
        handlers.onTest?.(getSettings());
        break;
      case "list-models":
        handlers.onListModels?.(getSettings());
        break;
      case "save":
        handlers.onSave?.(getSettings());
        break;
      default:
        break;
    }
  });

  // Delegação única de `change` — provedor selecionado e atalho compatível.
  root.addEventListener("change", (e) => {
    const target = e.target;
    if (!target) return;
    if (target === providerSelect) {
      updateProviderVisibility();
      return;
    }
    if (target === compatPresetSelect) {
      const preset = COMPAT_PRESETS.find((p) => p.id === target.value);
      if (preset) {
        fieldEls["providers.compat.baseUrl"].value = preset.baseUrl;
        fieldEls["providers.compat.model"].value = preset.model;
      }
      updateCompatNoKeyDisplay();
    }
  });

  function getSettings() {
    return {
      provider: providerSelect.value,
      language: fieldEls.language.value.trim(),
      indicatorPosition: fieldEls.indicatorPosition.value,
      providers: {
        claude: {
          apiKey: fieldEls["providers.claude.apiKey"].value.trim(),
          model: fieldEls["providers.claude.model"].value.trim(),
        },
        gemini: {
          apiKey: fieldEls["providers.gemini.apiKey"].value.trim(),
          model: fieldEls["providers.gemini.model"].value.trim(),
        },
        openai: {
          apiKey: fieldEls["providers.openai.apiKey"].value.trim(),
          model: fieldEls["providers.openai.model"].value.trim(),
        },
        compat: {
          presetId: compatPresetSelect.value,
          baseUrl: fieldEls["providers.compat.baseUrl"].value.trim(),
          apiKey: fieldEls["providers.compat.apiKey"].value.trim(),
          model: fieldEls["providers.compat.model"].value.trim(),
        },
      },
    };
  }

  function setSettings(settings) {
    const s = settings || {};
    const providers = s.providers || {};
    const claude = providers.claude || {};
    const gemini = providers.gemini || {};
    const openai = providers.openai || {};
    const compat = providers.compat || {};

    providerSelect.value = s.provider || "claude";
    fieldEls.language.value = s.language || "";
    fieldEls.indicatorPosition.value = s.indicatorPosition || "bottom";

    fieldEls["providers.claude.apiKey"].value = claude.apiKey || "";
    fieldEls["providers.claude.model"].value = claude.model || "";

    fieldEls["providers.gemini.apiKey"].value = gemini.apiKey || "";
    fieldEls["providers.gemini.model"].value = gemini.model || "";

    fieldEls["providers.openai.apiKey"].value = openai.apiKey || "";
    fieldEls["providers.openai.model"].value = openai.model || "";

    compatPresetSelect.value = compat.presetId || "";
    fieldEls["providers.compat.baseUrl"].value = compat.baseUrl || "";
    fieldEls["providers.compat.apiKey"].value = compat.apiKey || "";
    fieldEls["providers.compat.model"].value = compat.model || "";

    updateProviderVisibility();
    updateCompatNoKeyDisplay();
  }

  function setModels(list) {
    datalistEl.textContent = "";
    for (const id of list || []) {
      const opt = doc.createElement("option");
      opt.value = id;
      datalistEl.appendChild(opt);
    }
  }

  function setTestResult(result) {
    let text = "";
    if (result) {
      text = result.ok ? `✔ ok (modelo ${result.model})` : result.error || "Erro desconhecido.";
    }
    for (const el of testResultEls) {
      el.textContent = text;
    }
  }

  function setBusy(isBusy) {
    const disabled = !!isBusy;
    for (const btn of busyButtons) {
      btn.disabled = disabled;
    }
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
      toastEl.textContent = "";
    }, TOAST_HIDE_MS);
  }

  updateProviderVisibility();
  updateCompatNoKeyDisplay();

  return { setSettings, getSettings, setModels, setTestResult, setBusy, showToast };
}
