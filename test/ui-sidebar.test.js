import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { createSidebarView } from "../lib/ui/sidebar-view.js";

test("setState renderiza seleção e status; Desfazer chama onUndo com o id certo", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let undoneId = null;
  const view = createSidebarView(doc, root, { onUndo: (id) => { undoneId = id; } });

  view.setState({
    selection: [{ id: "s1", label: "button.x" }],
    history: [{ id: "r1", n: 1, request: "vermelho", summary: "ok", undone: false, opsCount: 2 }],
    activeCount: 2,
    originalMode: false,
    presetsApplied: [],
    fromPreset: false,
  });

  assert.ok(root.textContent.includes("button.x"));
  assert.ok(root.textContent.includes("Site MODIFICADO por você · 2 alterações"));
  assert.ok(root.textContent.includes("vermelho"));

  const undoBtn = root.querySelector('[data-action="undo"]');
  assert.equal(undoBtn.getAttribute("data-id"), "r1");
  undoBtn.click();
  assert.equal(undoneId, "r1");
});

test("histórico: entrada desfeita fica tachada e com botão Desfeito desabilitado", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createSidebarView(doc, root, {});
  view.setState({
    selection: [],
    history: [
      { id: "r1", n: 1, request: "vermelho", summary: "ok", undone: false, opsCount: 1 },
      { id: "r2", n: 2, request: "maior", summary: "ok2", undone: true, opsCount: 1 },
    ],
    activeCount: 1,
    originalMode: false,
    presetsApplied: [],
    fromPreset: false,
  });
  const entries = root.querySelectorAll(".aise-history-entry");
  // newest first: #2 vem antes de #1
  assert.equal(entries[0].querySelector(".aise-history-n").textContent, "#2");
  assert.ok(entries[0].className.includes("undone"));
  const undoBtn2 = entries[0].querySelector('[data-action="undo"]');
  assert.equal(undoBtn2.textContent, "Desfeito");
  assert.equal(undoBtn2.disabled, true);
});

test("enviar pedido: texto digitado é enviado (trim) e a textarea é limpa; texto vazio não dispara onSend", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let sent = null;
  createSidebarView(doc, root, { onSend: (t) => { sent = t; } });
  const textarea = root.querySelector('[data-role="input"]');
  const sendBtn = root.querySelector('[data-action="send"]');

  textarea.value = "  deixe azul  ";
  sendBtn.click();
  assert.equal(sent, "deixe azul");
  assert.equal(textarea.value, "");

  sent = null;
  textarea.value = "   ";
  sendBtn.click();
  assert.equal(sent, null);
});

test("setInspected mostra o rótulo, habilita usar-elemento-selecionado e dispara onUseSelected", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let used = false;
  const view = createSidebarView(doc, root, { onUseSelected: () => { used = true; } });
  const useBtn = root.querySelector('[data-action="use-selected"]');

  assert.ok(root.querySelector('[data-role="inspected"]').textContent.includes("Selecionado: nenhum"));
  assert.equal(useBtn.disabled, true);

  view.setInspected("button.x");
  assert.ok(root.querySelector('[data-role="inspected"]').textContent.includes("Selecionado: button.x"));
  assert.equal(useBtn.disabled, false);

  useBtn.click();
  assert.equal(used, true);
});

test("originalMode true troca o status para ORIGINAL e o rótulo do toggle para Ver modificado", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createSidebarView(doc, root, {});
  view.setState({
    selection: [],
    history: [{ id: "r1", n: 1, request: "vermelho", summary: "ok", undone: false, opsCount: 3 }],
    activeCount: 0,
    originalMode: true,
    presetsApplied: [],
    fromPreset: false,
  });
  assert.match(root.querySelector('[data-role="status"]').textContent, /Site ORIGINAL · 3 desligadas/);
  assert.equal(root.querySelector('[data-action="view-original"]').textContent, "Ver modificado");

  view.setState({
    selection: [],
    history: [],
    activeCount: 0,
    originalMode: false,
    presetsApplied: [],
    fromPreset: false,
  });
  assert.match(root.querySelector('[data-role="status"]').textContent, /Sem alterações/);
  assert.equal(root.querySelector('[data-action="view-original"]').textContent, "Ver original");
});

test("setBusy desabilita textarea e botão Enviar; setError mostra e limpa mensagem", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createSidebarView(doc, root, {});
  view.setBusy(true);
  assert.equal(root.querySelector('[data-role="input"]').disabled, true);
  assert.equal(root.querySelector('[data-action="send"]').disabled, true);
  view.setBusy(false);
  assert.equal(root.querySelector('[data-role="input"]').disabled, false);
  assert.equal(root.querySelector('[data-action="send"]').disabled, false);

  view.setError("deu ruim");
  assert.ok(root.textContent.includes("deu ruim"));
  view.setError(null);
  assert.ok(!root.textContent.includes("deu ruim"));
});

test("setConnection mostra o texto certo por status", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createSidebarView(doc, root, {});
  view.setConnection("ok");
  assert.ok(root.textContent.includes("Conectado"));
  view.setConnection("disconnected");
  assert.ok(root.textContent.includes("Desconectado — reabra o DevTools"));
  view.setConnection("no-content");
  assert.ok(root.textContent.includes("Extensão não carregada nesta aba"));
});

test("footer: undo-all, redo-all, save-preset e open-options chamam os handlers certos", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const calls = [];
  createSidebarView(doc, root, {
    onUndoAll: () => calls.push("undo-all"),
    onRedoAll: () => calls.push("redo-all"),
    onViewOriginal: () => calls.push("view-original"),
    onSavePreset: () => calls.push("save-preset"),
    onOpenOptions: () => calls.push("open-options"),
  });
  root.querySelector('[data-action="undo-all"]').click();
  root.querySelector('[data-action="redo-all"]').click();
  root.querySelector('[data-action="view-original"]').click();
  root.querySelector('[data-action="save-preset"]').click();
  root.querySelector('[data-action="open-options"]').click();
  assert.deepEqual(calls, ["undo-all", "redo-all", "view-original", "save-preset", "open-options"]);
});

test("Ctrl+Enter na textarea também envia", () => {
  const { doc, win } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let sent = null;
  createSidebarView(doc, root, { onSend: (t) => { sent = t; } });
  const textarea = root.querySelector('[data-role="input"]');
  textarea.value = "muda a cor";
  const evt = new win.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, cancelable: true });
  textarea.dispatchEvent(evt);
  assert.equal(sent, "muda a cor");
});

test("variante window: mira e 'Voltar para a página' no lugar do $0; picking reflete no botão", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let picks = 0;
  let docks = 0;
  const view = createSidebarView(doc, root, { onPick: () => picks++, onDock: () => docks++ }, { variant: "window" });
  assert.equal(root.querySelector('[data-action="use-selected"]'), null);
  assert.equal(root.querySelector('[data-role="inspected"]'), null);
  const pickBtn = root.querySelector('[data-action="pick"]');
  const dockBtn = root.querySelector('[data-action="dock"]');
  assert.ok(pickBtn && dockBtn);
  pickBtn.click();
  dockBtn.click();
  assert.equal(picks, 1);
  assert.equal(docks, 1);
  view.setInspected("div#x"); // no-op nesta variante, não pode lançar
  view.setState({ selection: [], history: [], activeCount: 0, originalMode: false, presetsApplied: [], picking: true });
  assert.equal(pickBtn.getAttribute("aria-pressed"), "true");
  assert.ok(pickBtn.classList.contains("aise-btn-active"));
  view.setState({ selection: [], history: [], activeCount: 0, originalMode: false, presetsApplied: [], picking: false });
  assert.equal(pickBtn.getAttribute("aria-pressed"), "false");
  assert.equal(pickBtn.textContent, "Selecionar elemento na página");
  view.setConnection("no-content");
  assert.match(root.querySelector('[data-role="connection"]').textContent, /recarregue a página/);
  view.setConnection("ok");
  assert.equal(root.querySelector('[data-role="connection"]').textContent, "Conectado à página");
});

test("variante padrão (devtools) continua com $0 e textos do DevTools", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createSidebarView(doc, root, {});
  assert.ok(root.querySelector('[data-action="use-selected"]'));
  assert.equal(root.querySelector('[data-action="pick"]'), null);
  view.setConnection("disconnected");
  assert.match(root.querySelector('[data-role="connection"]').textContent, /reabra o DevTools/);
});

test("footer: Copiar log chama onCopyLog e flashCopyLog troca o rótulo e restaura depois do timer", () => {
  const { doc, win } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let calls = 0;
  const view = createSidebarView(doc, root, { onCopyLog: () => calls++ });
  const btn = root.querySelector('[data-action="copy-log"]');
  assert.equal(btn.textContent, "Copiar log");
  btn.click();
  assert.equal(calls, 1);

  // controla o timer da janela do jsdom
  const timers = [];
  win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  win.clearTimeout = (id) => { timers[id - 1] = null; };

  view.flashCopyLog("Copiado ✓", 1500);
  assert.equal(btn.textContent, "Copiado ✓");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1500);

  view.flashCopyLog("Copiado ✓", 1500); // segundo clique cancela o timer anterior
  assert.equal(timers[0], null);
  assert.equal(timers.length, 2);

  timers[1].fn();
  assert.equal(btn.textContent, "Copiar log");
});
