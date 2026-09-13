import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { createPopupView } from "../lib/ui/popup-view.js";

test("setState renderiza as três variantes de status e o rótulo/disabled do toggle e do Desfazer tudo", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createPopupView(doc, root, {});

  view.setState({ activeCount: 4, originalMode: false });
  assert.ok(root.querySelector('[data-role="status"]').textContent.includes("Site modificado por você · 4 alterações"));
  assert.equal(root.querySelector('[data-action="toggle-original"]').textContent, "Ver original");
  assert.equal(root.querySelector('[data-action="toggle-original"]').disabled, false);
  assert.equal(root.querySelector('[data-action="undo-all"]').disabled, false);

  view.setState({ activeCount: 0, originalMode: true });
  assert.equal(root.querySelector('[data-role="status"]').textContent, "Site original");
  assert.equal(root.querySelector('[data-action="toggle-original"]').textContent, "Ver modificado");
  assert.equal(root.querySelector('[data-action="toggle-original"]').disabled, false);
  assert.equal(root.querySelector('[data-action="undo-all"]').disabled, true);

  view.setState({ activeCount: 0, originalMode: false });
  assert.equal(root.querySelector('[data-role="status"]').textContent, "Sem alterações");
  assert.equal(root.querySelector('[data-action="toggle-original"]').disabled, true);
  assert.equal(root.querySelector('[data-action="undo-all"]').disabled, true);
});

test("setPresets renderiza linhas com nome e contagem; Aplicar agora, Auto-aplicar e Remover chamam os handlers certos", () => {
  const { doc, win } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const calls = [];
  const view = createPopupView(doc, root, {
    onApplyPreset: (id) => calls.push(["apply", id]),
    onSetAutoApply: (id, v) => calls.push(["auto", id, v]),
    onRemovePreset: (id) => calls.push(["remove", id]),
  });

  view.setPresets([
    { id: "p1", name: "Modo escuro", ops: [1, 2, 3], autoApply: false },
    { id: "p2", name: "Fonte grande", ops: [1], autoApply: true },
  ]);

  const rows = root.querySelectorAll(".aise-popup-preset");
  assert.equal(rows.length, 2);
  assert.ok(rows[0].textContent.includes("Modo escuro"));
  assert.ok(rows[0].textContent.includes("3 alterações"));
  assert.ok(rows[1].textContent.includes("Fonte grande"));
  assert.ok(rows[1].textContent.includes("1 alterações"));

  const checkbox1 = rows[0].querySelector('[data-action="auto-apply"]');
  assert.equal(checkbox1.checked, false);
  const checkbox2 = rows[1].querySelector('[data-action="auto-apply"]');
  assert.equal(checkbox2.checked, true);

  root.querySelector('[data-action="apply"][data-id="p1"]').click();
  assert.deepEqual(calls.at(-1), ["apply", "p1"]);

  checkbox1.checked = true;
  checkbox1.dispatchEvent(new win.Event("change", { bubbles: true }));
  assert.deepEqual(calls.at(-1), ["auto", "p1", true]);

  checkbox2.checked = false;
  checkbox2.dispatchEvent(new win.Event("change", { bubbles: true }));
  assert.deepEqual(calls.at(-1), ["auto", "p2", false]);

  root.querySelector('[data-action="remove"][data-id="p2"]').click();
  assert.deepEqual(calls.at(-1), ["remove", "p2"]);
});

test("lista vazia de presets mostra a mensagem de nenhum preset salvo", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createPopupView(doc, root, {});
  view.setPresets([]);
  assert.ok(root.textContent.includes("Nenhum preset salvo para este site."));
});

test("setState(null) mostra extensão não carregada, desabilita toggle/undo, mas mantém a lista de presets", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createPopupView(doc, root, {});
  view.setPresets([{ id: "p1", name: "Modo escuro", ops: [1], autoApply: false }]);
  view.setState(null);
  assert.ok(root.querySelector('[data-role="status"]').textContent.includes("Extensão não carregada nesta aba"));
  assert.equal(root.querySelector('[data-action="toggle-original"]').disabled, true);
  assert.equal(root.querySelector('[data-action="undo-all"]').disabled, true);
  assert.ok(root.textContent.includes("Modo escuro"));
});

test("setUneditable substitui todo o conteúdo pela mensagem", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const view = createPopupView(doc, root, {});
  view.setUneditable("Esta página não pode ser editada");
  assert.equal(root.textContent.trim(), "Esta página não pode ser editada");
  assert.equal(root.querySelector('[data-role="status"]'), null);
});

test("setError mostra e limpa a mensagem de erro; Opções chama onOpenOptions", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let opened = false;
  const view = createPopupView(doc, root, { onOpenOptions: () => { opened = true; } });

  view.setError("deu ruim");
  assert.ok(root.textContent.includes("deu ruim"));
  view.setError(null);
  assert.ok(!root.textContent.includes("deu ruim"));

  root.querySelector('[data-action="options"]').click();
  assert.equal(opened, true);
});

test("toggle-original e undo-all chamam onToggleOriginal e onUndoAll", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const calls = [];
  const view = createPopupView(doc, root, {
    onToggleOriginal: () => calls.push("toggle"),
    onUndoAll: () => calls.push("undo-all"),
  });
  view.setState({ activeCount: 2, originalMode: false });
  root.querySelector('[data-action="toggle-original"]').click();
  root.querySelector('[data-action="undo-all"]').click();
  assert.deepEqual(calls, ["toggle", "undo-all"]);
});

test("Selecionar elemento chama onPickElement; fica desabilitado sem extensão ou ocupado", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let picks = 0;
  const view = createPopupView(doc, root, { onPickElement: () => { picks++; } });
  const btn = root.querySelector('[data-action="pick"]');
  assert.equal(btn.textContent, "Selecionar elemento");
  assert.equal(btn.disabled, true, "desabilitado antes do estado chegar");

  view.setState({ activeCount: 0, originalMode: false });
  assert.equal(btn.disabled, false, "sem alterações ainda dá para selecionar");
  btn.click();
  assert.equal(picks, 1);

  view.setBusy(true);
  assert.equal(btn.disabled, true);
  view.setBusy(false);
  assert.equal(btn.disabled, false);

  view.setState(null);
  assert.equal(btn.disabled, true, "extensão não carregada na aba");
});

test("o aviso fixo sobre auto-aplicar está sempre presente", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  createPopupView(doc, root, {});
  assert.ok(
    root.textContent.includes(
      "Presets com auto-aplicar ligado mudam o site ao carregar. O banner laranja sempre indica quando você está vendo uma versão modificada."
    )
  );
});

test("cada preset tem um botão Copiar log que chama onCopyPresetLog; flashPresetCopy troca o rótulo, sobrevive a re-render e restaura no timer", () => {
  const { doc, win } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  const calls = [];
  const view = createPopupView(doc, root, { onCopyPresetLog: (id) => calls.push(id) });
  view.setPresets([
    { id: "p1", name: "A", ops: [1], autoApply: false },
    { id: "p2", name: "B", ops: [], autoApply: false },
  ]);
  const btns = root.querySelectorAll('[data-action="copy-log"]');
  assert.equal(btns.length, 2);
  assert.equal(btns[0].textContent, "Copiar log");
  assert.ok(btns[0].title.length > 0, "tem tooltip explicando");
  btns[1].click();
  assert.deepEqual(calls, ["p2"]);

  const timers = [];
  win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  win.clearTimeout = (id) => { timers[id - 1] = null; };

  view.flashPresetCopy("p1");
  assert.equal(root.querySelector('[data-action="copy-log"][data-id="p1"]').textContent, "Copiado ✓");
  assert.equal(root.querySelector('[data-action="copy-log"][data-id="p2"]').textContent, "Copiar log", "só o preset copiado muda");
  assert.equal(timers[0].ms, 1500);

  view.setBusy(true); // re-render da lista no meio do flash
  view.setBusy(false);
  assert.equal(root.querySelector('[data-action="copy-log"][data-id="p1"]').textContent, "Copiado ✓", "rótulo sobrevive ao re-render");

  view.flashPresetCopy("p1", "Copiado ✓", 1500); // segundo clique cancela o timer anterior
  assert.equal(timers[0], null);
  timers[1].fn();
  assert.equal(root.querySelector('[data-action="copy-log"][data-id="p1"]').textContent, "Copiar log");
});

test("status inicial é Conectando…; Tentar de novo só aparece quando a página não respondeu, chama onRetry e trava quando ocupado", () => {
  const { doc } = makeDoc("<body><div id='root'></div></body>");
  const root = doc.getElementById("root");
  let retries = 0;
  const view = createPopupView(doc, root, { onRetry: () => retries++ });
  const retryBox = root.querySelector('[data-role="retry"]');
  const retryBtn = root.querySelector('[data-action="retry"]');
  assert.equal(root.querySelector('[data-role="status"]').textContent, "Conectando à página…");
  assert.equal(retryBox.hidden, true, "escondido antes de saber se a página responde");

  view.setState(null);
  assert.equal(retryBox.hidden, false);
  assert.equal(retryBtn.textContent, "Tentar de novo");
  assert.equal(retryBtn.disabled, false);
  retryBtn.click();
  assert.equal(retries, 1);

  view.setBusy(true);
  assert.equal(retryBtn.disabled, true, "não empilha tentativas");
  view.setBusy(false);
  assert.equal(retryBtn.disabled, false);

  view.setState({ activeCount: 0, originalMode: false });
  assert.equal(retryBox.hidden, true, "some quando a página responde");
});
