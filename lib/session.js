// lib/session.js — estado de sessão do content script: seleção, histórico de
// pedidos, modo original e presets aplicados. Módulo ES puro: nada de
// `document`/`window`/`chrome`/`console` globais — tudo entra via parâmetros
// de `createSession`. `applyOps`/`undoRecords`/`redoRecords` (lib/ops.js),
// `stabilizeOps` (lib/storage.js) e `sanitize` (normalmente
// `(html) => sanitizeHTML(html, doc)`) são injetados pelo chamador; apenas as
// utilidades de seleção (lib/selector.js, lib/serialize.js) são importadas
// diretamente, por serem parte estrutural da própria noção de seleção.

import { stableSelector, shortLabel } from "./selector.js";
import { tagSelection } from "./serialize.js";

export function createSession({ doc, win, applyOps, undoRecords, redoRecords, stabilizeOps, sanitize }) {
  const opts = { sanitize };

  let selection = []; // [{id, label, el}]
  let history = []; // [{id, n, request, summary, ops, records, undone, stableSelection}]
  let presetsApplied = []; // [{id, name, records, applied, total}]
  let originalMode = false;
  let toggledEntries = []; // entradas revertidas temporariamente pelo modo original
  let toggledPresets = []; // presets revertidos temporariamente pelo modo original
  let counter = 0;

  // ---------------------------------------------------------------------
  // Seleção
  // ---------------------------------------------------------------------

  function setSelectionElements(elements) {
    for (const item of selection) {
      if (!elements.includes(item.el)) item.el.removeAttribute("data-aise-id");
    }
    const ids = tagSelection(elements);
    selection = elements.map((el, i) => ({ id: ids[i], label: shortLabel(el), el }));
  }

  function selectOnly(el) {
    setSelectionElements([el]);
  }

  function toggle(el) {
    const idx = selection.findIndex((s) => s.el === el);
    const elements =
      idx === -1
        ? [...selection.map((s) => s.el), el]
        : selection.filter((_, i) => i !== idx).map((s) => s.el);
    setSelectionElements(elements);
  }

  function remove(id) {
    const elements = selection.filter((s) => s.id !== id).map((s) => s.el);
    setSelectionElements(elements);
  }

  function clear() {
    setSelectionElements([]);
  }

  function getSelection() {
    return selection.map(({ id, label, el }) => ({ id, label, el }));
  }

  // ---------------------------------------------------------------------
  // Pedidos (histórico)
  // ---------------------------------------------------------------------

  function addRequest({ request, summary, ops }) {
    // Seletor estável calculado ANTES de aplicar as ops: preserva a referência
    // ao elemento mesmo que a operação o remova ou mude seus atributos.
    const stableSelection = selection.map((s) => ({ id: s.id, selector: stableSelector(s.el) }));
    const records = applyOps(ops, doc, opts);
    counter += 1;
    const entry = {
      id: `r${counter}`,
      n: counter,
      request,
      summary,
      ops,
      records,
      undone: false,
      stableSelection,
    };
    history.push(entry);
    return entry;
  }

  // `originalMode` já reverteu tudo no DOM sem tocar em `entry.undone` (ver
  // `toggleOriginal` abaixo); desfazer/refazer uma entrada individual nesse
  // meio-tempo corromperia esse estado (chamaria `undoRecords` de novo sobre
  // records já revertidos, e o `toggleOriginal` de saída reaplicaria uma
  // entrada que o usuário acabou de pedir para manter desfeita). Por isso
  // ambos viram no-op — devolvem `false` — enquanto `originalMode` estiver
  // ligado; o chamador deve mandar sair do modo original primeiro.

  function undoRequest(id) {
    if (originalMode) return false;
    const entry = history.find((e) => e.id === id);
    if (!entry || entry.undone) return false;
    undoRecords(entry.records);
    entry.undone = true;
    return true;
  }

  function redoRequest(id) {
    if (originalMode) return false;
    const entry = history.find((e) => e.id === id);
    if (!entry || !entry.undone) return false;
    entry.records = redoRecords(entry.records, doc, opts);
    entry.undone = false;
    return true;
  }

  // ---------------------------------------------------------------------
  // Modo original
  // ---------------------------------------------------------------------

  function toggleOriginal() {
    if (!originalMode) {
      toggledEntries = history.filter((e) => !e.undone);
      for (const e of toggledEntries) undoRecords(e.records);
      toggledPresets = presetsApplied.slice();
      for (const p of toggledPresets) undoRecords(p.records);
      originalMode = true;
    } else {
      for (const e of toggledEntries) e.records = redoRecords(e.records, doc, opts);
      for (const p of toggledPresets) p.records = redoRecords(p.records, doc, opts);
      toggledEntries = [];
      toggledPresets = [];
      originalMode = false;
    }
  }

  // ---------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------

  function applyPreset(preset) {
    const records = applyOps(preset.ops, doc, opts);
    const applied = records.filter((r) => r.matched > 0).length;
    const total = preset.ops.length;
    const missing = records.filter((r) => r.matched === 0).map((r) => r.op.selector);
    presetsApplied.push({ id: preset.id, name: preset.name, records, applied, total });
    return { applied, total, missing };
  }

  function collectPresetOps() {
    return history.filter((e) => !e.undone).flatMap((e) => stabilizeOps(e.ops, e.stableSelection));
  }

  function disableAutoIds() {
    return presetsApplied.map((p) => p.id);
  }

  // ---------------------------------------------------------------------
  // Estado agregado
  // ---------------------------------------------------------------------

  function activeCount() {
    if (originalMode) return 0;
    const entriesSum = history.filter((e) => !e.undone).reduce((sum, e) => sum + e.ops.length, 0);
    const presetsSum = presetsApplied.reduce((sum, p) => sum + p.total, 0);
    return entriesSum + presetsSum;
  }

  function publicState({ origin, url, title } = {}) {
    return {
      selection: selection.map(({ id, label }) => ({ id, label })),
      history: history.map((e) => ({
        id: e.id,
        n: e.n,
        request: e.request,
        summary: e.summary,
        undone: e.undone,
        opsCount: e.ops.length,
      })),
      activeCount: activeCount(),
      originalMode,
      presetsApplied: presetsApplied.map((p) => ({ id: p.id, name: p.name, applied: p.applied, total: p.total })),
      fromPreset: presetsApplied.length > 0,
      origin,
      url,
      title,
    };
  }

  return {
    // seleção
    selectOnly,
    toggle,
    remove,
    clear,
    getSelection,
    // pedidos
    addRequest,
    undoRequest,
    redoRequest,
    // modo original
    toggleOriginal,
    get originalMode() {
      return originalMode;
    },
    // presets
    applyPreset,
    collectPresetOps,
    disableAutoIds,
    // agregados
    activeCount,
    publicState,
  };
}
