import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { createPanel } from "../lib/ui/panel.js";
import { createIndicator } from "../lib/ui/indicator.js";

test("painel abre, lista seleção e envia pedido", () => {
  const { doc } = makeDoc("<body></body>");
  let sent = null;
  const p = createPanel(doc, { onSubmit: (t) => (sent = t), onUndo() {}, onUndoAll() {}, onRedoAll() {}, onSavePreset() {}, onClose() {}, onRemoveSelection() {}, onOpenOptions() {} });
  p.show(); p.setSelection([{ id: "s1", label: "button.x" }]);
  const root = doc.querySelector("aise-panel").shadowRoot;
  assert.ok(root.textContent.includes("button.x"));
  root.querySelector("textarea").value = "vermelho";
  root.querySelector("form").dispatchEvent(new doc.defaultView.Event("submit", { cancelable: true }));
  assert.equal(sent, "vermelho");
  p.setHistory([{ id: "r1", n: 1, request: "vermelho", summary: "ok", undone: false, opsCount: 2 }]);
  assert.ok(root.textContent.includes("ok"));
  p.hide(); assert.equal(p.isOpen(), false);
});

test("indicador some sem alterações, mostra banner e alterna para original", () => {
  const { doc } = makeDoc("<body></body>");
  const ind = createIndicator(doc, { position: "bottom", onViewOriginal() {}, onEdit() {}, onDisableAuto() {} });
  ind.update({ activeCount: 0, originalMode: false, presetNames: [], fromPreset: false, applied: 0, total: 0 });
  assert.equal(doc.querySelector("aise-indicator"), null);
  ind.update({ activeCount: 4, originalMode: false, presetNames: ["Menu"], fromPreset: true, autoApplied: true, applied: 4, total: 4 });
  const root = doc.querySelector("aise-indicator").shadowRoot;
  assert.match(root.textContent, /MODIFICADA por você/);
  assert.match(root.textContent, /Menu/);
  assert.ok(root.querySelector("[data-action=disable-auto]"));
  root.querySelector("[data-action=minimize]").click();
  assert.match(root.textContent, /Modificado por você · 4/);
  ind.update({ activeCount: 4, originalMode: true, presetNames: ["Menu"], fromPreset: true, autoApplied: true, applied: 4, total: 4 });
  assert.match(root.textContent, /ORIGINAL/);
});

test("indicador só oferece 'Desligar auto-aplicar' quando autoApplied é verdadeiro", () => {
  const { doc } = makeDoc("<body></body>");
  const ind = createIndicator(doc, { position: "bottom", onViewOriginal() {}, onEdit() {}, onDisableAuto() {} });

  // preset aplicado à mão pelo popup: fromPreset true, mas nada a desligar
  ind.update({ activeCount: 2, originalMode: false, presetNames: ["Menu"], fromPreset: true, autoApplied: false, applied: 2, total: 2 });
  const root = doc.querySelector("aise-indicator").shadowRoot;
  assert.equal(root.querySelector("[data-action=disable-auto]"), null);

  ind.update({ activeCount: 2, originalMode: false, presetNames: ["Menu"], fromPreset: true, autoApplied: true, applied: 2, total: 2 });
  assert.ok(root.querySelector("[data-action=disable-auto]"));
});

test("createPanel é idempotente: segunda chamada não empilha hosts", () => {
  const { doc } = makeDoc("<body></body>");
  const handlers = { onSubmit() {}, onUndo() {}, onUndoAll() {}, onRedoAll() {}, onSavePreset() {}, onClose() {}, onRemoveSelection() {}, onOpenOptions() {} };
  createPanel(doc, handlers);
  createPanel(doc, handlers);
  assert.equal(doc.querySelectorAll("aise-panel").length, 1);
});

test("setBusy(true) desabilita textarea e botão de envio", () => {
  const { doc } = makeDoc("<body></body>");
  const p = createPanel(doc, { onSubmit() {}, onUndo() {}, onUndoAll() {}, onRedoAll() {}, onSavePreset() {}, onClose() {}, onRemoveSelection() {}, onOpenOptions() {} });
  p.show();
  const root = doc.querySelector("aise-panel").shadowRoot;
  p.setBusy(true);
  assert.equal(root.querySelector("textarea").disabled, true);
  assert.equal(root.querySelector('button[type="submit"]').disabled, true);
  assert.match(root.textContent, /Pensando…/);
  p.setBusy(false);
  assert.equal(root.querySelector("textarea").disabled, false);
  assert.equal(root.querySelector('button[type="submit"]').disabled, false);
});

test("histórico com entrada desfeita renderiza tachado e botão Desfeito desabilitado", () => {
  const { doc } = makeDoc("<body></body>");
  const p = createPanel(doc, { onSubmit() {}, onUndo() {}, onUndoAll() {}, onRedoAll() {}, onSavePreset() {}, onClose() {}, onRemoveSelection() {}, onOpenOptions() {} });
  p.show();
  p.setHistory([{ id: "r1", n: 1, request: "vermelho", summary: "ok", undone: true, opsCount: 2 }]);
  const root = doc.querySelector("aise-panel").shadowRoot;
  const undoBtn = root.querySelector('[data-action="undo"][data-id="r1"]');
  assert.equal(undoBtn.textContent, "Desfeito");
  assert.equal(undoBtn.disabled, true);
  const entry = root.querySelector(".aise-history-entry");
  assert.ok(entry.className.includes("undone"));
});

test("setPosition do indicador redocka sem perder estado minimizado", () => {
  const { doc } = makeDoc("<body></body>");
  const ind = createIndicator(doc, { position: "bottom", onViewOriginal() {}, onEdit() {}, onDisableAuto() {} });
  ind.update({ activeCount: 2, originalMode: false, presetNames: [], fromPreset: false, applied: 2, total: 2 });
  const root = doc.querySelector("aise-indicator").shadowRoot;
  root.querySelector('[data-action="minimize"]').click();
  assert.match(root.textContent, /Modificado por você · 2/);
  ind.setPosition("top");
  assert.match(root.textContent, /Modificado por você · 2/);
  const container = root.querySelector(".aise-indicator");
  assert.ok(container.className.includes("aise-indicator-top"));
});

test("banner sem presetNames omite a parte do preset", () => {
  const { doc } = makeDoc("<body></body>");
  const ind = createIndicator(doc, { position: "bottom", onViewOriginal() {}, onEdit() {}, onDisableAuto() {} });
  ind.update({ activeCount: 3, originalMode: false, presetNames: [], fromPreset: false, applied: 3, total: 3 });
  const root = doc.querySelector("aise-indicator").shadowRoot;
  assert.match(root.textContent, /deste site \(3 alterações\)\. Não é o site original\./);
  assert.doesNotMatch(root.textContent, /preset/);
});

test("indicador se reancora: host arrancado do DOM volta no próximo update", () => {
  const { doc } = makeDoc("<body></body>");
  const ind = createIndicator(doc, { position: "bottom", onViewOriginal() {}, onEdit() {}, onDisableAuto() {} });
  ind.update({ activeCount: 2, originalMode: false, presetNames: [], fromPreset: false, autoApplied: false, applied: 2, total: 2 });

  const host = doc.querySelector("aise-indicator");
  assert.ok(host);
  assert.equal(host.style.display, "block", "host reforça display inline");
  host.remove();
  assert.equal(doc.querySelector("aise-indicator"), null);

  ind.update({ activeCount: 2, originalMode: false, presetNames: [], fromPreset: false, autoApplied: false, applied: 2, total: 2 });
  const back = doc.querySelector("aise-indicator");
  assert.ok(back, "host volta ao DOM");
  assert.match(back.shadowRoot.textContent, /MODIFICADA por você/);
});

test("modo original desabilita o botão de aplicar do painel e sair reabilita", () => {
  const { doc } = makeDoc("<body></body>");
  const p = createPanel(doc, { onSubmit() {}, onUndo() {}, onUndoAll() {}, onRedoAll() {}, onSavePreset() {}, onClose() {}, onRemoveSelection() {}, onOpenOptions() {} });
  p.show();
  const root = doc.querySelector("aise-panel").shadowRoot;
  const submit = root.querySelector('button[type="submit"]');

  p.setOriginalMode(true);
  assert.equal(submit.disabled, true);
  assert.equal(submit.title, "Saia do modo original para editar.");

  // setBusy(false) não pode reabilitar o envio enquanto o modo original vale
  p.setBusy(true);
  p.setBusy(false);
  assert.equal(submit.disabled, true, "modo original continua bloqueando");

  p.setOriginalMode(false);
  assert.equal(submit.disabled, false);
});

test("botão de mira do cabeçalho chama onTogglePicker e setPicking reflete aria-pressed", () => {
  const { doc } = makeDoc("<body></body>");
  let toggles = 0;
  const p = createPanel(doc, { onSubmit() {}, onUndo() {}, onUndoAll() {}, onRedoAll() {}, onSavePreset() {}, onClose() {}, onRemoveSelection() {}, onOpenOptions() {}, onTogglePicker: () => { toggles++; } });
  p.show();
  const root = doc.querySelector("aise-panel").shadowRoot;
  const btn = root.querySelector('[data-action="pick"]');
  assert.equal(btn.getAttribute("aria-label"), "Selecionar elemento");
  assert.equal(btn.getAttribute("aria-pressed"), "false");
  btn.click();
  assert.equal(toggles, 1);
  p.setPicking(true);
  assert.equal(btn.getAttribute("aria-pressed"), "true");
  assert.ok(btn.classList.contains("aise-icon-btn-active"));
  p.setPicking(false);
  assert.equal(btn.getAttribute("aria-pressed"), "false");
  assert.ok(!btn.classList.contains("aise-icon-btn-active"));
});

test("hide() cancela o timer do toast: ele não reaparece na próxima abertura", () => {
  const { doc, win } = makeDoc("<body></body>");
  const p = createPanel(doc, { onSubmit() {}, onUndo() {}, onUndoAll() {}, onRedoAll() {}, onSavePreset() {}, onClose() {}, onRemoveSelection() {}, onOpenOptions() {} });
  p.show();
  const root = doc.querySelector("aise-panel").shadowRoot;
  const toastEl = root.querySelector('[data-role="toast"]');

  let pending = 0;
  const realSet = win.setTimeout;
  const realClear = win.clearTimeout;
  win.setTimeout = (fn, ms) => { pending += 1; return realSet(fn, ms); };
  win.clearTimeout = (id) => { pending -= 1; return realClear(id); };

  p.toast("Preset salvo.");
  assert.equal(toastEl.hidden, false);
  assert.equal(pending, 1);

  p.hide();
  assert.equal(pending, 0, "timer do toast cancelado no hide()");
  assert.equal(toastEl.hidden, true);

  p.show();
  assert.equal(toastEl.hidden, true, "toast não volta ao reabrir o painel");

  win.setTimeout = realSet;
  win.clearTimeout = realClear;
});

test("arrastar pelo cabeçalho move o painel, limita à viewport e a posição sobrevive a show()", () => {
  const { doc, win } = makeDoc("<body></body>");
  let detached = 0;
  const p = createPanel(doc, { onDetach: () => detached++ });
  p.show({ left: 100, top: 50, bottom: 60 });
  const root = doc.querySelector("aise-panel").shadowRoot;
  const container = root.querySelector(".aise-panel");
  assert.equal(container.style.left, "100px");
  assert.equal(container.style.top, "68px");
  assert.equal(p.getPosition(), null);

  const header = root.querySelector(".aise-panel-header");
  header.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 150, clientY: 80 }));
  assert.ok(container.classList.contains("aise-panel-dragging"));
  win.dispatchEvent(new win.MouseEvent("mousemove", { bubbles: true, clientX: 250, clientY: 130 }));
  assert.equal(container.style.left, "200px");
  assert.equal(container.style.top, "118px");
  // Arrastar além da borda esquerda/superior é limitado pela margem.
  win.dispatchEvent(new win.MouseEvent("mousemove", { bubbles: true, clientX: -500, clientY: -500 }));
  assert.equal(container.style.left, "12px");
  assert.equal(container.style.top, "12px");
  win.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true }));
  assert.equal(container.classList.contains("aise-panel-dragging"), false);
  // Movimentos após soltar não movem mais.
  win.dispatchEvent(new win.MouseEvent("mousemove", { bubbles: true, clientX: 400, clientY: 400 }));
  assert.equal(container.style.left, "12px");
  assert.deepEqual(p.getPosition(), { left: 12, top: 12 });

  // Reabrir ancorado em outro elemento mantém a posição escolhida.
  p.hide();
  p.show({ left: 300, top: 300, bottom: 320 });
  assert.equal(container.style.left, "12px");
  assert.equal(container.style.top, "12px");

  // Clicar num botão do cabeçalho não inicia arrasto.
  const detachBtn = root.querySelector('[data-action="detach"]');
  detachBtn.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
  assert.equal(container.classList.contains("aise-panel-dragging"), false);
  detachBtn.click();
  assert.equal(detached, 1);
});
