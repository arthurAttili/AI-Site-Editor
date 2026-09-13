// popup.js — página do popup da toolbar (Task 13). Único responsável por
// falar com `chrome.tabs`, `chrome.scripting`, `chrome.runtime` e
// `chrome.storage.local`; a renderização em si mora em
// lib/ui/popup-view.js (módulo puro, testado à parte). Este arquivo é
// código de "cola": pode tocar `document`/`window`/`chrome` livremente.

import { getPresets, updatePreset, deletePreset } from "./lib/storage.js";
import { createPopupView } from "./lib/ui/popup-view.js";
import { buildPresetReport } from "./lib/report.js";
import { copyText } from "./lib/ui/clipboard.js";

const UNEDITABLE_TEXT = "Esta página não pode ser editada";

const root = document.getElementById("root");
const view = createPopupView(document, root, {
  onPickElement,
  onToggleOriginal,
  onUndoAll,
  onApplyPreset,
  onSetAutoApply,
  onRemovePreset,
  onCopyPresetLog,
  onRetry,
  onOpenOptions,
});

let tabId = null;
let origin = null;
let presetsCache = [];

// GET_STATE pode chegar antes do content script terminar de carregar (aba
// recém-aberta, página pesada ainda em `document_idle`) ou nunca (aba aberta
// antes de a extensão ser instalada/recarregada, página que bloqueia scripts).
// Estratégia: tenta; na primeira falha injeta `content.js` uma vez (ele tem
// guarda contra carga dupla) e volta a tentar com esperas crescentes. Só
// depois disso mostra "extensão não carregada" — com o motivo e um botão
// "Tentar de novo", em vez de deixar os botões mudos sem explicação.
const GET_STATE_TIMEOUT_MS = 2500;
const RETRY_DELAYS_MS = [300, 600, 1000, 1500];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Mensagens cruas do Chrome ("Could not establish connection. Receiving end
// does not exist.", "The message port closed…") não dizem nada ao usuário.
function friendlyError(err) {
  const raw = (err && err.message) || String(err || "");
  if (/Receiving end does not exist|message port closed|tempo esgotado|Cannot access|cannot be scripted|Frame with ID/i.test(raw)) {
    return `Não foi possível falar com a página (${raw.replace(/\.$/, "")}). Recarregue a aba (F5) e tente de novo.`;
  }
  return raw || "Não foi possível falar com a página. Recarregue a aba (F5) e tente de novo.";
}

// `sendMessage` pode nunca resolver: se o content script registrou o listener
// mas travou antes de responder, a promise fica pendurada e o popup mostra
// "carregando" para sempre. Timeout explícito → tratado como falha.
async function sendGetState(id) {
  let timer;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(id, { type: "GET_STATE" }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("tempo esgotado ao falar com a página")), GET_STATE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    // O perdedor da race não é cancelado sozinho: sem isso, uma resposta rápida
    // deixa um timer de 5 s vivo (e o popup pode fechar antes de ele vencer).
    clearTimeout(timer);
  }
}

// Devolve a resposta do content script (`{ok, state}` ou `{ok:false, error}`)
// ou, esgotadas as tentativas, `{ok:false, error}` com o último motivo.
async function getStateWithRetry(id) {
  let lastError = null;
  let injected = false;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const reply = await sendGetState(id);
      if (reply) return reply;
      lastError = new Error("a página não respondeu");
    } catch (err) {
      lastError = err;
    }
    if (!injected) {
      injected = true;
      try {
        await chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] });
      } catch (err) {
        // Sem permissão para injetar (página do Chrome, loja, PDF…): não adianta insistir.
        return { ok: false, error: friendlyError(err) };
      }
    }
    if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
  }
  return { ok: false, error: friendlyError(lastError) };
}

async function refreshState() {
  const reply = await getStateWithRetry(tabId);
  if (reply && reply.ok) {
    view.setState(reply.state);
    view.setError(null);
  } else {
    // O content script já devolve mensagem em pt-BR quando falhou ao iniciar;
    // as falhas de transporte passam por friendlyError em getStateWithRetry.
    view.setState(null);
    view.setError((reply && reply.error) || friendlyError(null));
  }
}

async function refreshPresets() {
  presetsCache = await getPresets(chrome.storage.local, origin);
  view.setPresets(presetsCache);
}

async function refreshAll() {
  await refreshState();
  await refreshPresets();
}

// Mensagens que esperam `{ok:true, state}`: qualquer outra coisa (recusa
// lógica do content script, ex. "Saia do modo original…", ou a promise
// rejeitando por falta de listener) vira exceção — `runAction` trata tudo
// igual, mostrando a mensagem em `setError`.
async function sendAction(type, extra = {}) {
  const reply = await chrome.tabs.sendMessage(tabId, { type, ...extra });
  if (!reply || !reply.ok) throw new Error((reply && reply.error) || "Falha desconhecida.");
  return reply;
}

// Fluxo comum de toda ação do popup: roda `fn`, sempre re-busca estado e
// presets em seguida (mesmo se `fn` falhou) e reporta qualquer erro via
// `setError` — nunca deixa uma exceção escapar para o console do popup.
async function runAction(fn) {
  view.setBusy(true);
  let actionError = null;
  try {
    await fn();
  } catch (err) {
    actionError = friendlyError(err);
  }
  try {
    await refreshAll();
  } catch (err) {
    actionError = actionError || friendlyError(err);
  }
  // refreshState limpa/define o erro de conexão; o erro da ação em si tem
  // precedência para o usuário saber por que o clique não fez nada.
  if (actionError) view.setError(actionError);
  view.setBusy(false);
}

// O popup fecha logo depois de ligar o picker: com ele aberto o mouse não
// chega à página, então o usuário não teria como apontar o elemento.
function onPickElement() {
  runAction(async () => {
    await sendAction("START_PICKER");
    window.close();
  });
}

function onToggleOriginal() {
  runAction(() => sendAction("TOGGLE_ORIGINAL"));
}

function onUndoAll() {
  runAction(() => sendAction("UNDO_ALL"));
}

function onApplyPreset(id) {
  runAction(() => sendAction("APPLY_PRESET", { presetId: id }));
}

// Ligar auto-aplicar só grava no storage — não aplica agora. Desligar para
// um preset que já está aplicado na aba também não muda nada na página
// (o aviso de "só no próximo carregamento" é do lado do content script);
// aqui só re-renderiza com o valor novo.
function onSetAutoApply(id, value) {
  runAction(() => updatePreset(chrome.storage.local, origin, id, { autoApply: value }));
}

function onRemovePreset(id) {
  const preset = presetsCache.find((p) => p.id === id);
  const name = preset ? preset.name : "";
  if (!window.confirm(`Remover o preset "${name}"?`)) return;
  runAction(() => deletePreset(chrome.storage.local, origin, id));
}

// Log de handoff de um preset já salvo: não depende da página responder,
// por isso não passa por runAction (que re-busca o estado da aba).
async function onCopyPresetLog(id) {
  const preset = presetsCache.find((p) => p.id === id);
  if (!preset) return;
  const md = buildPresetReport(preset, { origin, generatedAt: new Date() });
  const ok = await copyText(md, { clipboard: navigator.clipboard, doc: document });
  if (ok) {
    view.flashPresetCopy(id);
  } else {
    view.setError("Não foi possível copiar o log. Tente de novo com o popup em foco.");
  }
}

// Botão "Tentar de novo" (aparece quando a página não respondeu): só refaz
// a busca de estado/presets, com a mesma sequência de injeção e retentativas.
function onRetry() {
  runAction(async () => {});
}

function onOpenOptions() {
  chrome.runtime.openOptionsPage();
}

function isEditableUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !isEditableUrl(tab.url)) {
    view.setUneditable(UNEDITABLE_TEXT);
    return;
  }
  tabId = tab.id;
  origin = new URL(tab.url).origin;
  await refreshAll();
}

init().catch((err) => {
  view.setError((err && err.message) || String(err));
});
