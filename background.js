// background.js — service worker (Manifest V3, módulo ES). É o hub da extensão:
// dono do menu de contexto, único lugar que faz chamadas de rede aos provedores
// de IA (o content script nunca chama a rede), retransmissor entre o sidebar do
// DevTools e o content script de cada aba, e responsável pelo badge da toolbar.
//
// Import estático — service worker de módulo suporta `import` no topo do arquivo.
import { getSettings } from "./lib/storage.js";
import { callProvider, testProvider, listModels } from "./lib/ai-call.js";

const CONTEXT_MENU_ID = "aise-edit";
const WARN_BADGE_MS = 3000;

// tabId → Set<Port> de sidebars do DevTools abertos para aquela aba.
const devtoolsPortsByTab = new Map();

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

// `state`: `{activeCount, originalMode}` vindo do content script. ORIG (cinza)
// tem prioridade sobre MOD (vermelho); sem estado relevante, o badge some.
function updateBadge(tabId, state) {
  let text = "";
  let color = "";
  if (state && state.originalMode) {
    text = "ORIG";
    color = "#5f6368";
  } else if (state && state.activeCount > 0) {
    text = "MOD";
    color = "#d93025";
  }
  chrome.action.setBadgeText({ tabId, text });
  if (text) {
    chrome.action.setBadgeBackgroundColor({ tabId, color });
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ tabId, color: "#ffffff" });
    }
  }
}

// Badge de aviso temporário quando o menu de contexto não conseguiu abrir o
// editor (sem permissão de `chrome.notifications` — ver manifest.json).
// O timer é rastreado por aba: sem isso, dois avisos seguidos deixam dois
// setTimeout vivos e o primeiro a vencer limpa o badge do segundo antes da
// hora (e ainda apaga um badge de contagem que já tenha voltado).
const warnBadgeTimers = new Map();

function warnBadge(tabId) {
  const pending = warnBadgeTimers.get(tabId);
  if (pending) clearTimeout(pending);
  chrome.action.setBadgeText({ tabId, text: "!" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" });
  const timer = setTimeout(() => {
    warnBadgeTimers.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: "" });
  }, WARN_BADGE_MS);
  warnBadgeTimers.set(tabId, timer);
}

// ---------------------------------------------------------------------------
// Portas do DevTools (`aise-devtools`)
// ---------------------------------------------------------------------------

function registerDevtoolsPort(tabId, port) {
  if (!devtoolsPortsByTab.has(tabId)) devtoolsPortsByTab.set(tabId, new Set());
  devtoolsPortsByTab.get(tabId).add(port);
}

function unregisterDevtoolsPort(tabId, port) {
  const ports = devtoolsPortsByTab.get(tabId);
  if (!ports) return;
  ports.delete(port);
  if (ports.size === 0) devtoolsPortsByTab.delete(tabId);
}

// Repassa `{type:"STATE_CHANGED", state}` para toda porta DevTools registrada
// para essa aba (usado pelo handler de `STATE_CHANGED` do onMessage).
function forwardStateChanged(tabId, state) {
  const ports = devtoolsPortsByTab.get(tabId);
  if (!ports) return;
  for (const port of ports) {
    try {
      port.postMessage({ type: "STATE_CHANGED", state });
    } catch {
      // porta pode já ter desconectado entre o forEach e o postMessage
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "aise-devtools") return;

  let tabId = null;

  port.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === "INIT") {
      // Um segundo INIT (ex.: DevTools trocou de página inspecionada) não pode
      // deixar a porta registrada sob o tabId antigo.
      if (tabId != null) unregisterDevtoolsPort(tabId, port);
      tabId = msg.tabId;
      registerDevtoolsPort(tabId, port);
      return;
    }
    if (tabId == null) return; // mensagem antes do INIT: ignora
    const { type, reqId, ...rest } = msg;
    chrome.tabs
      .sendMessage(tabId, { type, ...rest })
      .then((reply) => port.postMessage({ type: "REPLY", reqId, reply }))
      .catch((err) => port.postMessage({ type: "REPLY", reqId, reply: { ok: false, error: err.message } }));
  });

  port.onDisconnect.addListener(() => {
    if (tabId != null) unregisterDevtoolsPort(tabId, port);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  devtoolsPortsByTab.delete(tabId);
  const pending = warnBadgeTimers.get(tabId);
  if (pending) {
    clearTimeout(pending);
    warnBadgeTimers.delete(tabId);
  }
});

// ---------------------------------------------------------------------------
// Menu de contexto
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: CONTEXT_MENU_ID, title: "Editar com IA", contexts: ["all"] });
  });
});

// chrome:// , edge:// , about: e a Chrome Web Store nunca aceitam
// `chrome.scripting.executeScript` — tentar só gera erro sem chance de sucesso.
const BLOCKED_URL_RE = /^(chrome|edge|about):/i;
const WEB_STORE_RE = /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)\//i;

function isInjectable(url) {
  return typeof url === "string" && url !== "" && !BLOCKED_URL_RE.test(url) && !WEB_STORE_RE.test(url);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab || tab.id == null) return;

  if (!isInjectable(tab.url)) {
    console.warn(`[aiSiteEditor] não é possível injetar o editor em: ${tab.url}`);
    return;
  }

  const openEditor = () =>
    chrome.tabs.sendMessage(tab.id, { type: "OPEN_EDITOR", frameId: info.frameId }, { frameId: info.frameId });

  try {
    await openEditor();
  } catch {
    // Provável ausência do content script (aba aberta antes da instalação/reload).
    // Injeta e tenta mais uma vez.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [info.frameId] }, files: ["content.js"] });
      await openEditor();
    } catch (err) {
      console.warn("[aiSiteEditor] falha ao abrir o editor:", err);
      warnBadge(tab.id);
    }
  }
});

// ---------------------------------------------------------------------------
// Mensagens (`chrome.runtime.onMessage`)
// ---------------------------------------------------------------------------

async function handleAiRequest(message) {
  try {
    // `getSettings` mora dentro do try: se o storage falhar, a resposta ainda
    // precisa do contrato {ok:false, error, kind} — nunca só {ok:false, error}.
    const settings = await getSettings(chrome.storage.local);
    const result = await callProvider(settings, { system: message.system, user: message.user, schema: message.schema }, { fetch });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message, kind: err.kind || "http" };
  }
}

async function handleListModels(message) {
  try {
    const models = await listModels(message.settings, { fetch });
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err.message, kind: err.kind || "http" };
  }
}

async function routeMessage(message, sender) {
  switch (message && message.type) {
    case "AI_REQUEST":
      return handleAiRequest(message);
    case "TEST_PROVIDER":
      // `settings` vem do formulário de opções ainda não salvo — usa como está,
      // nunca lê do storage aqui.
      return testProvider(message.settings, { fetch });
    case "LIST_MODELS":
      return handleListModels(message);
    case "STATE_CHANGED": {
      // Só o frame de topo fala pela aba. Um iframe com o content script
      // rodando tem a própria sessão; deixá-lo escrever no badge e nas portas
      // do DevTools sobrescreveria o estado real da página.
      if (sender.frameId !== undefined && sender.frameId !== 0) return { ok: true };
      const tabId = sender.tab && sender.tab.id;
      if (tabId != null) {
        updateBadge(tabId, message.state);
        forwardStateChanged(tabId, message.state);
      }
      return { ok: true };
    }
    case "OPEN_OPTIONS":
      chrome.runtime.openOptionsPage();
      return { ok: true };
    default:
      return { ok: false, error: "tipo desconhecido" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  routeMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // canal assíncrono sempre aberto até o sendResponse acima
});
