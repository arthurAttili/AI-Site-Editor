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
let picker = null;
// Editor "destacado": a janela separada (editor.html) está aberta para esta
// aba. O painel flutuante fica escondido e a seleção/histórico são espelhados
// na janela via STATE_CHANGED.
let detached = false;
let indicator = null;
let logger = null;
let settings = null;

// Mensagem do erro que derrubou a inicialização (null enquanto tudo correu
// bem). Guardada para que GET_STATE responda `{ok:false, error}` em vez de
// deixar o popup esperando para sempre por uma promessa que nunca resolve.
let initError = null;

let readyResolve;
const ready = new Promise((resolve) => {
  readyResolve = resolve;
});

// Step 2: captura do botão direito — guarda o alvo real do clique, já que o
// menu de contexto do Chrome não informa qual elemento foi clicado.
document.addEventListener("contextmenu", (e) => { lastTarget = e.target; }, true);

// Step 3: Shift+clique alterna seleção enquanto o painel estiver aberto (ou
// o editor estiver destacado numa janela separada). Registrado desde já
// (fora do IIFE assíncrono) — `panel` começa null e o guard abaixo o ignora
// até o painel existir e estar aberto.
document.addEventListener(
  "click",
  (e) => {
    if (!panel || !(panel.isOpen() || detached) || !e.shiftKey) return;
    if (picker && picker.isActive()) return; // o picker já trata o clique
    if (isAiseHostTarget(e.target)) return;
    e.preventDefault();
    session.toggle(e.target);
    syncSelectionUi();
    if (detached) refresh();
  },
  true
);

function isAiseHostTarget(target) {
  return typeof target.closest === "function" && !!target.closest("aise-panel, aise-indicator, aise-picker");
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
  // Inicialização falhou (import de lib/ bloqueado, storage indisponível…):
  // toda mensagem responde o erro em vez de estourar um TypeError em `session`
  // — o popup e o sidebar precisam de uma resposta para não ficarem esperando.
  if (initError) return { ok: false, error: initError };

  switch (message && message.type) {
    case "OPEN_EDITOR":
      // Pelo menu de contexto: abre com o elemento clicado já selecionado e
      // liga a mira, como o inspetor do F12 — um clique troca o alvo.
      openEditorFor(lastTarget || document.body);
      startPicker();
      return { ok: true, state: currentState() };
    case "DETACH_EDITOR":
      await detachEditor();
      return { ok: true, state: currentState() };
    case "DOCK_EDITOR":
      dockEditor();
      return { ok: true, state: currentState() };
    case "EDITOR_WINDOW_CLOSED":
      // Fechar a janela separada equivale a fechar o editor. Se já voltamos
      // ao modo painel (DOCK_EDITOR), o aviso é tardio e não pode fechar o
      // painel recém-reaberto.
      if (detached) {
        detached = false;
        closePanel();
      }
      return { ok: true, state: currentState() };
    case "START_PICKER":
      startPicker();
      return { ok: true, state: currentState() };
    case "STOP_PICKER":
      stopPicker();
      return { ok: true, state: currentState() };
    case "TOGGLE_PICKER":
      if (picker && picker.isActive()) stopPicker();
      else startPicker();
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
      if (session.originalMode) return originalModeEditBlockedReply();
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
  const [ops, selector, serialize, sanitize, prompt, storage, loggerMod, panelMod, indicatorMod, pickerMod, sessionMod] =
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
      import(url("ui/picker.js")),
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
    picker: pickerMod,
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
  return { ...session.publicState(currentMeta()), picking: !!(picker && picker.isActive()), detached };
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
    onTogglePicker: () => {
      if (picker && picker.isActive()) stopPicker();
      else startPicker();
    },
    onDetach: () => detachEditor(),
  });
  return panel;
}

// Destaca o editor para uma janela separada: esconde o painel (sem limpar a
// seleção — ela continua destacada na página e aparece na janela) e pede ao
// background para abrir/focar a janela.
async function detachEditor() {
  stopPicker();
  if (panel) panel.hide();
  detached = true;
  const reply = await sendToBackground({ type: "OPEN_EDITOR_WINDOW" });
  if (!reply || !reply.ok) {
    detached = false;
    if (panel && session.getSelection().length) {
      panel.show();
      panel.setError((reply && reply.error) || "Não foi possível abrir a janela separada.");
    }
    return;
  }
  refresh();
}

// Volta o editor para dentro da página (a janela se fecha sozinha).
function dockEditor() {
  detached = false;
  sendToBackground({ type: "CLOSE_EDITOR_WINDOW" });
  ensurePanel();
  syncSelectionUi();
  panel.setError(null);
  panel.show();
  panel.focus();
  refresh();
}

// Traz a janela separada para frente (após escolher um elemento na página).
function focusEditorWindow() {
  if (detached) sendToBackground({ type: "OPEN_EDITOR_WINDOW" });
}

// ---------------------------------------------------------------------------
// Seletor de elementos ("mira"): ponteiro em cruz, contorno no elemento sob o
// mouse; clique seleciona (e desliga), Shift+clique adiciona, Esc cancela.
// ---------------------------------------------------------------------------

function ensurePicker() {
  if (picker) return picker;
  picker = libs.picker.createPicker(document, {
    onPick: (el, { additive }) => {
      if (additive) {
        ensurePanel();
        if (!detached && !panel.isOpen()) {
          openEditorFor(el);
        } else {
          session.toggle(el);
          injectHighlightStyle();
          syncSelectionUi();
          refresh();
        }
        return;
      }
      openEditorFor(el);
      panel.setPicking(false);
      focusEditorWindow();
    },
    onCancel: () => {
      if (panel) panel.setPicking(false);
      if (detached) refresh();
    },
  });
  return picker;
}

function startPicker() {
  ensurePicker().start();
  if (panel) panel.setPicking(true);
  if (detached) refresh();
}

function stopPicker() {
  const wasActive = !!(picker && picker.isActive());
  if (picker) picker.stop();
  if (panel) panel.setPicking(false);
  if (detached && wasActive) refresh();
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
  if (detached) {
    // A janela separada é quem mostra a seleção; o painel continua escondido.
    refresh();
    return;
  }
  const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : undefined;
  panel.show(rect);
  panel.focus();
}

function closePanel() {
  stopPicker();
  if (panel) panel.hide();
  session.clear();
  removeHighlightStyle();
  refresh();
}

// ---------------------------------------------------------------------------
// Step 4: submissão de pedido de edição
// ---------------------------------------------------------------------------

async function submitRequest(text) {
  const p = ensurePanel();
  if (session.originalMode) {
    p.setError(ORIGINAL_MODE_EDIT_BLOCK_MSG);
    return;
  }
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
// Editar no modo original aplicaria a mudança sobre um DOM revertido e a
// entrada seria "reaplicada" de novo ao sair do modo — o mesmo motivo pelo
// qual undo/redo já eram barrados.
const ORIGINAL_MODE_EDIT_BLOCK_MSG = "Saia do modo original para editar.";

function originalModeBlockedReply() {
  if (panel) panel.setError(ORIGINAL_MODE_BLOCK_MSG);
  return { ok: false, error: ORIGINAL_MODE_BLOCK_MSG };
}

function originalModeEditBlockedReply() {
  if (panel) panel.setError(ORIGINAL_MODE_EDIT_BLOCK_MSG);
  return { ok: false, error: ORIGINAL_MODE_EDIT_BLOCK_MSG };
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
  if (panel) {
    panel.setHistory(state.history);
    panel.setOriginalMode(state.originalMode);
  }
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

// Um preset vem do storage — que pode ter sido escrito por uma versão antiga
// da extensão, editado à mão ou corrompido — e vai direto para applyOps. Passa
// pelo mesmo validateOps das respostas do modelo antes de tocar no DOM.
function checkedPresetOps(preset) {
  const { ops, errors } = libs.ops.validateOps(preset.ops);
  if (errors.length > 0) {
    console.warn(`[Editor IA] preset "${preset.name}" tem ${errors.length} operação(ões) inválida(s), ignorada(s): ${errors.join("; ")}`);
  }
  return ops;
}

async function applyPresetById(presetId) {
  const presets = await libs.storage.getPresets(chrome.storage.local, location.origin);
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) return;
  const ops = checkedPresetOps(preset);
  if (ops.length === 0) return;
  const { applied, total, missing } = session.applyPreset({ ...preset, ops });
  logger.preset({ name: preset.name, applied, total, missing });
  refresh();
}

async function autoApplyPresets() {
  // Só o frame de topo auto-aplica: um iframe é outra página, com outra
  // origem possível, e aplicar o preset do site dentro dele duplicaria as
  // alterações e a contagem do indicador.
  if (window !== window.top) return;
  const presets = await libs.storage.getPresets(chrome.storage.local, location.origin);
  const autoPresets = presets.filter((p) => p.autoApply);
  for (const preset of autoPresets) {
    const ops = checkedPresetOps(preset);
    if (ops.length === 0) continue;
    const { applied, total, missing } = session.applyPreset({ ...preset, ops }, { auto: true });
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
  try {
    await init();
  } catch (err) {
    initError = `Não foi possível iniciar o Editor IA nesta página: ${err && err.message ? err.message : String(err)}`;
    console.error("[Editor IA] falha na inicialização:", err);
  } finally {
    // `ready` SEMPRE resolve: quem espera por ela (handleMessage) precisa
    // seguir e responder o erro, não ficar pendurado.
    readyResolve();
  }
})();

async function init() {
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
    onEdit: () => {
      openEditorFor(lastTarget || document.body);
      focusEditorWindow();
    },
    onDisableAuto: () => disableAutoFlow(),
  });

  // Página recarregada com a janela separada ainda aberta: continua no modo
  // destacado em vez de voltar a mostrar o painel na página.
  const status = await sendToBackground({ type: "EDITOR_WINDOW_STATUS" });
  if (status && status.ok && status.open) detached = true;

  await autoApplyPresets();
  refresh();
}
})();
