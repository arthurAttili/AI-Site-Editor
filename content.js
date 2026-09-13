// content.js — orquestrador do content script: roda em toda página, dono da
// seleção, do painel e do indicador, aplica as operações vindas do
// background e fala com o Console via lib/logger.js. Script clássico
// (não-módulo): os módulos de lib/ são carregados dinamicamente via
// `import(chrome.runtime.getURL(...))` porque `content_scripts` não suporta
// `type: "module"`. Só este arquivo toca `document`/`window`/`chrome`/
// `console` diretamente — toda a lógica de seleção/histórico/presets pura
// mora em lib/session.js.

// Envolvido numa IIFE só para que os `return` de guarda abaixo sejam válidos
// (um script clássico não permite `return` fora de função) — continua sendo
// um único script de topo, sem `type: "module"`.
(function () {
if (window.__aiseLoaded) return;
window.__aiseLoaded = true;

// Documentos sem <html> (erro de rede, etc.) ou que não são HTML (XML/SVG
// servidos com outro content-type) não recebem o editor.
if (!document.documentElement || document.contentType !== "text/html") return;

// ---------------------------------------------------------------------------
// Estado de módulo (preenchido depois que loadLibs() resolve)
// ---------------------------------------------------------------------------

let lastTarget = null;
let session = null;
let panel = null;
let indicator = null;
let logger = null;
let settings = null;

let readyResolve;
const ready = new Promise((resolve) => {
  readyResolve = resolve;
});

// Step 2: captura do botão direito — guarda o alvo real do clique, já que o
// menu de contexto do Chrome não informa qual elemento foi clicado.
document.addEventListener("contextmenu", (e) => { lastTarget = e.target; }, true);

// Step 3: Shift+clique alterna seleção enquanto o painel estiver aberto.
// Registrado desde já (fora do IIFE assíncrono) — `panel` começa null e o
// guard abaixo o ignora até o painel existir e estar aberto.
document.addEventListener(
  "click",
  (e) => {
    if (!panel || !panel.isOpen() || !e.shiftKey) return;
    if (isAiseHostTarget(e.target)) return;
    e.preventDefault();
    session.toggle(e.target);
    syncSelectionUi();
  },
  true
);

function isAiseHostTarget(target) {
  return typeof target.closest === "function" && !!target.closest("aise-panel, aise-indicator");
}

// Mensagens do background/DevTools/popup: o listener é registrado já, antes
// dos módulos terminarem de carregar — `ready` garante que um OPEN_EDITOR
// disparado cedo não se perca, e a resposta sempre chega (return true mantém
// o canal aberto).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      await ready;
      const reply = await handleMessage(message);
      sendResponse(reply || { ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: (err && err.message) || String(err) });
    }
  })();
  return true;
});

async function handleMessage(message) {
  switch (message && message.type) {
    case "OPEN_EDITOR":
      openEditorFor(lastTarget || document.body);
      return { ok: true, state: currentState() };
    case "PICK_MARKED": {
      const el = document.querySelector("[data-aise-pick]");
      if (el) {
        el.removeAttribute("data-aise-pick");
        openEditorFor(el);
      }
      return { ok: true, state: currentState() };
    }
    case "REQUEST_EDIT":
      await submitRequest(message.text);
      return { ok: true, state: currentState() };
    case "GET_STATE":
      return { ok: true, state: currentState() };
    case "UNDO":
      if (session.originalMode) return originalModeBlockedReply();
      doUndo(message.requestId);
      return { ok: true, state: currentState() };
    case "UNDO_ALL":
      if (session.originalMode) return originalModeBlockedReply();
      doUndoAll();
      return { ok: true, state: currentState() };
    case "REDO_ALL":
    case "REAPPLY":
      // REAPPLY é alias de REDO_ALL (refaz toda entrada desfeita) — não é
      // um refresh à toa: reaplicar de fato as ops é o que a ação promete.
      if (session.originalMode) return originalModeBlockedReply();
      doRedoAll();
      return { ok: true, state: currentState() };
    case "TOGGLE_ORIGINAL":
      doToggleOriginal();
      return { ok: true, state: currentState() };
    case "SAVE_PRESET":
      await savePresetFlow(message.name);
      return { ok: true, state: currentState() };
    case "APPLY_PRESET":
      await applyPresetById(message.presetId);
      return { ok: true, state: currentState() };
    case "DISABLE_AUTO":
      await disableAutoFlow();
      return { ok: true, state: currentState() };
    default:
      return { ok: false, error: "tipo de mensagem desconhecido" };
  }
}

// ---------------------------------------------------------------------------
// Carregamento dos módulos de lib/
// ---------------------------------------------------------------------------

async function loadLibs() {
  const url = (path) => chrome.runtime.getURL(`lib/${path}`);
  const [ops, selector, serialize, sanitize, prompt, storage, loggerMod, panelMod, indicatorMod, sessionMod] =
    await Promise.all([
      import(url("ops.js")),
      import(url("selector.js")),
      import(url("serialize.js")),
      import(url("sanitize.js")),
      import(url("prompt.js")),
      import(url("storage.js")),
      import(url("logger.js")),
      import(url("ui/panel.js")),
      import(url("ui/indicator.js")),
      import(url("session.js")),
    ]);
  return {
    ops,
    selector,
    serialize,
    sanitize,
    prompt,
    storage,
    logger: loggerMod,
    panel: panelMod,
    indicator: indicatorMod,
    session: sessionMod,
  };
}

// ---------------------------------------------------------------------------
// Highlight de seleção — `[data-aise-id]` nunca conta como alteração e nunca
// é logado; é só apresentação.
// ---------------------------------------------------------------------------

function injectHighlightStyle() {
  if (document.querySelector("style[data-aise-ui]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-aise-ui", "");
  style.textContent = "[data-aise-id]{outline:2px dashed #ee8d49 !important; outline-offset:2px !important}";
  document.head.appendChild(style);
}

function removeHighlightStyle() {
  const style = document.querySelector("style[data-aise-ui]");
  if (style) style.remove();
}

// ---------------------------------------------------------------------------
// Painel / seleção
// ---------------------------------------------------------------------------

function currentMeta() {
  return { origin: location.origin, url: location.href, title: document.title };
}

function currentState() {
  return session.publicState(currentMeta());
}

function ensurePanel() {
  if (panel) return panel;
  panel = panelFactory(document, {
    onSubmit: (text) => submitRequest(text),
    onUndo: (id) => doUndo(id),
    onUndoAll: () => doUndoAll(),
    onRedoAll: () => doRedoAll(),
    onSavePreset: () => savePresetFlow(),
    onClose: () => closePanel(),
    onRemoveSelection: (id) => {
      session.remove(id);
      syncSelectionUi();
    },
    onOpenOptions: () => sendToBackground({ type: "OPEN_OPTIONS" }),
  });
  return panel;
}

function syncSelectionUi() {
  if (panel) panel.setSelection(session.getSelection().map(({ id, label }) => ({ id, label })));
}

function openEditorFor(el) {
  if (!el) return;
  session.selectOnly(el);
  injectHighlightStyle();
  ensurePanel();
  syncSelectionUi();
  panel.setError(null);
  const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : undefined;
  panel.show(rect);
  panel.focus();
}

function closePanel() {
  if (panel) panel.hide();
  session.clear();
  removeHighlightStyle();
}

// ---------------------------------------------------------------------------
// Step 4: submissão de pedido de edição
// ---------------------------------------------------------------------------

async function submitRequest(text) {
  const p = ensurePanel();
  p.setBusy(true);
  p.setError(null);

  const selectionEls = session.getSelection().map((s) => s.el);
  const ctx = libs.serialize.buildSelectionContext(selectionEls, {
    win: window,
    stableSelector: libs.selector.stableSelector,
    shortLabel: libs.selector.shortLabel,
  });
  const historyForPrompt = currentState().history.map((h) => ({ request: h.request, summary: h.summary }));

  const { system, user } = libs.prompt.buildPrompt({
    language: settings.language,
    url: location.href,
    title: document.title,
    selection: ctx,
    history: historyForPrompt,
    request: text,
  });

  const nextN = currentState().history.length + 1;
  const started = Date.now();
  const response = await sendToBackground({ type: "AI_REQUEST", system, user, schema: libs.prompt.OPS_SCHEMA });
  const ms = Date.now() - started;

  if (!response || !response.ok) {
    const msg = (response && response.error) || "Falha desconhecida";
    p.setBusy(false);
    p.setError(msg);
    logger.error({ n: nextN, request: text, message: msg });
    if (response && response.kind === "no-key") {
      p.toast("Abra as opções para configurar a chave.");
    }
    refresh();
    return;
  }

  const { ops, errors, summary, provider, model } = response;
  const targets = session.getSelection().map(({ id, label }) => ({ id, label }));
  const entry = session.addRequest({ request: text, summary, ops });

  p.setBusy(false);
  p.setError(errors && errors.length > 0 ? errors.join("; ") : null);
  logger.request({
    n: entry.n,
    request: text,
    targets,
    provider,
    model,
    ms: typeof response.ms === "number" ? response.ms : ms,
    records: entry.records,
    summary,
  });
  refresh();
}

// ---------------------------------------------------------------------------
// Step 5: desfazer / refazer / modo original
// ---------------------------------------------------------------------------

// Desfazer/refazer individual não faz sentido com o modo original ligado:
// `session.undoRequest`/`redoRequest` já viram no-op nesse estado (ver
// lib/session.js), mas aqui a gente também barra antes de mexer e avisa o
// usuário — tanto pelo botão do painel quanto por mensagem (ver `handleMessage`).
const ORIGINAL_MODE_BLOCK_MSG = "Saia do modo original para desfazer/refazer.";

function originalModeBlockedReply() {
  if (panel) panel.setError(ORIGINAL_MODE_BLOCK_MSG);
  return { ok: false, error: ORIGINAL_MODE_BLOCK_MSG };
}

function blockIfOriginal() {
  if (!session.originalMode) return false;
  if (panel) panel.setError(ORIGINAL_MODE_BLOCK_MSG);
  return true;
}

function doUndo(id) {
  if (blockIfOriginal()) return;
  const found = currentState().history.find((h) => h.id === id);
  session.undoRequest(id);
  if (found) logger.undo({ n: found.n, request: found.request });
  refresh();
}

function doUndoAll() {
  if (blockIfOriginal()) return;
  const active = currentState().history.filter((h) => !h.undone);
  // Do mais novo para o mais antigo: com duas edições sobrepostas no mesmo
  // elemento, desfazer na ordem de aplicação deixaria o valor da primeira
  // edição no lugar do valor original da página.
  for (let i = active.length - 1; i >= 0; i--) session.undoRequest(active[i].id);
  for (const h of active) logger.undo({ n: h.n, request: h.request });
  refresh();
}

function doRedoAll() {
  if (blockIfOriginal()) return;
  const undone = currentState().history.filter((h) => h.undone);
  for (const h of undone) session.redoRequest(h.id);
  refresh();
}

function doToggleOriginal() {
  session.toggleOriginal();
  logger.originalMode(session.originalMode);
  refresh();
}

// ---------------------------------------------------------------------------
// Step 6: refresh — indicador, painel, STATE_CHANGED
// ---------------------------------------------------------------------------

function refresh() {
  const state = currentState();
  // "total"/"applied" para o indicador cobrem tanto o modo normal quanto o
  // modo original: como entradas suprimidas pelo modo original continuam
  // com `undone:false` (só o DOM é revertido), a soma dá tanto o total ativo
  // quanto — no modo original — o total "desligado temporariamente".
  const total =
    state.history.filter((h) => !h.undone).reduce((sum, h) => sum + h.opsCount, 0) +
    state.presetsApplied.reduce((sum, p) => sum + p.applied, 0);
  const applied = state.presetsApplied.reduce((sum, p) => sum + p.applied, 0);

  if (indicator) {
    indicator.update({
      activeCount: state.activeCount,
      originalMode: state.originalMode,
      presetNames: state.presetsApplied.map((p) => p.name),
      fromPreset: state.fromPreset,
      autoApplied: state.autoApplied,
      applied,
      total,
    });
  }
  if (panel) panel.setHistory(state.history);
  sendToBackground({ type: "STATE_CHANGED", state });
}

// ---------------------------------------------------------------------------
// Comunicação com o background — nunca deixa o content script quebrar se o
// contexto da extensão foi invalidado (página antiga após reload/update).
// ---------------------------------------------------------------------------

async function sendToBackground(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err), kind: "http" };
  }
}

// ---------------------------------------------------------------------------
// Step 7: presets
// ---------------------------------------------------------------------------

// `panel.toast(...)` só aparece na tela se o painel estiver com
// `display:flex` (`show()`) — o toast é um filho do container do painel.
// SAVE_PRESET e DISABLE_AUTO podem chegar sem o painel nunca ter sido
// aberto nesta sessão (banner do indicador, popup, sidebar do DevTools), daí
// abrir o painel antes de mandar o toast; também loga no console para quem
// está acompanhando por ali.
function showToast(msg) {
  const p = ensurePanel();
  if (!p.isOpen()) p.show();
  p.toast(msg);
  console.info(`[aiSiteEditor] ${msg}`);
}

async function savePresetFlow(providedName) {
  let name = providedName;
  if (!name) {
    name = window.prompt("Nome do preset:");
    if (!name) return; // cancelado silenciosamente
  }
  const ops = session.collectPresetOps();
  await libs.storage.savePreset(chrome.storage.local, location.origin, { name, ops });
  showToast("Preset salvo. Ele não será aplicado sozinho; ligue 'auto-aplicar' no popup se quiser.");
}

async function applyPresetById(presetId) {
  const presets = await libs.storage.getPresets(chrome.storage.local, location.origin);
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) return;
  const { applied, total, missing } = session.applyPreset(preset);
  logger.preset({ name: preset.name, applied, total, missing });
  refresh();
}

async function autoApplyPresets() {
  const presets = await libs.storage.getPresets(chrome.storage.local, location.origin);
  const autoPresets = presets.filter((p) => p.autoApply);
  for (const preset of autoPresets) {
    const { applied, total, missing } = session.applyPreset(preset, { auto: true });
    logger.preset({ name: preset.name, applied, total, missing });
  }
  if (autoPresets.length > 0) {
    const state = currentState();
    logger.modifiedWarning({ activeCount: state.activeCount, presetNames: state.presetsApplied.map((p) => p.name) });
  }
}

async function disableAutoFlow() {
  const ids = session.disableAutoIds();
  for (const id of ids) {
    await libs.storage.updatePreset(chrome.storage.local, location.origin, id, { autoApply: false });
  }
  showToast("Auto-aplicar desligado. No próximo carregamento você verá o site original.");
  refresh();
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

let libs = null;
let panelFactory = null;

(async () => {
  libs = await loadLibs();
  panelFactory = libs.panel.createPanel;

  logger = libs.logger.createLogger(console);
  const sanitize = (html) => libs.sanitize.sanitizeHTML(html, document);

  session = libs.session.createSession({
    doc: document,
    win: window,
    applyOps: libs.ops.applyOps,
    undoRecords: libs.ops.undoRecords,
    redoRecords: libs.ops.redoRecords,
    stabilizeOps: libs.storage.stabilizeOps,
    sanitize,
    warn: (msg) => console.warn(`[Editor IA] ${msg}`),
  });

  settings = await libs.storage.getSettings(chrome.storage.local);

  indicator = libs.indicator.createIndicator(document, {
    position: settings.indicatorPosition,
    onViewOriginal: () => doToggleOriginal(),
    onEdit: () => openEditorFor(lastTarget || document.body),
    onDisableAuto: () => disableAutoFlow(),
  });

  await autoApplyPresets();
  refresh();

  readyResolve();
})();
})();
