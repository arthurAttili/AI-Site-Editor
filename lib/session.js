// lib/session.js — estado de sessão do content script: seleção, histórico de
// pedidos, modo original e presets aplicados. Módulo ES puro: nada de
// `document`/`window`/`chrome`/`console` globais — tudo entra via parâmetros
// de `createSession`. `applyOps`/`undoRecords`/`redoRecords` (lib/ops.js),
// `stabilizeOps` (lib/storage.js) e `sanitize` (normalmente
// `(html) => sanitizeHTML(html, doc)`) são injetados pelo chamador; apenas as
// utilidades de seleção (lib/selector.js, lib/serialize.js) são importadas
// diretamente, por serem parte estrutural da própria noção de seleção.
//
// Duas invariantes de ordem valem para tudo aqui:
//   1. Toda aplicação (pedido ou preset) recebe um `seq` global crescente.
//      Desfazer em lote acontece do `seq` maior para o menor e refazer do
//      menor para o maior — com duas edições sobrepostas no mesmo elemento,
//      desfazer na ordem de aplicação deixaria o valor da primeira edição no
//      lugar do valor original.
//   2. Refazer NUNCA reexecuta os records antigos: reaplica `stableOps`
//      (as ops com `[data-aise-id="sN"]` já trocados por seletores estáveis,
//      calculados no momento do pedido). O marcador `data-aise-id` é
//      reciclado a cada nova seleção, então um redo baseado nele acertaria o
//      elemento errado.

import { stableSelector, shortLabel } from "./selector.js";
import { tagSelection } from "./serialize.js";

export function createSession({
  doc,
  win,
  applyOps,
  undoRecords,
  redoRecords,
  stabilizeOps,
  sanitize,
  warn,
}) {
  const opts = { sanitize };
  const warnFn = typeof warn === "function" ? warn : () => {};

  let selection = []; // [{id, label, el}]
  let history = []; // [{id, n, seq, request, summary, ops, stableOps, records, undone, stableSelection}]
  let presetsApplied = []; // [{id, seq, name, stableOps, records, applied, total, auto}]
  let originalMode = false;
  let toggledEntries = []; // entradas revertidas temporariamente pelo modo original
  let toggledPresets = []; // presets revertidos temporariamente pelo modo original
  let counter = 0;
  let seqCounter = 0;

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
  // Reaplicação (redo) — sempre a partir de `stableOps`
  // ---------------------------------------------------------------------

  function reapply(item) {
    item.records = applyOps(item.stableOps, doc, opts);
    return item.records;
  }

  // Reaplica uma entrada do histórico. Se nenhuma op casou com o DOM atual
  // (elemento removido, página renavegada, seletor quebrado), a entrada volta
  // a contar como desfeita em vez de inflar o `activeCount` sem ter mudado nada.
  function reapplyEntry(entry) {
    const records = reapply(entry);
    const matchedAny = records.some((r) => r.matched > 0);
    if (!matchedAny && entry.stableOps.length > 0) {
      entry.undone = true;
      warnFn(`não foi possível refazer o pedido #${entry.n}: nenhum elemento correspondeu na página atual.`);
      return false;
    }
    entry.undone = false;
    return true;
  }

  function reapplyPreset(preset) {
    const records = reapply(preset);
    preset.applied = records.filter((r) => r.matched > 0).length;
    return preset.applied;
  }

  // ---------------------------------------------------------------------
  // Pedidos (histórico)
  // ---------------------------------------------------------------------

  function addRequest({ request, summary, ops }) {
    // Seletor estável calculado ANTES de aplicar as ops: preserva a referência
    // ao elemento mesmo que a operação o remova ou mude seus atributos.
    const stableSelection = selection.map((s) => ({ id: s.id, selector: stableSelector(s.el) }));
    const stableOps = stabilizeOps(ops, stableSelection);
    const records = applyOps(ops, doc, opts);
    counter += 1;
    seqCounter += 1;
    const entry = {
      id: `r${counter}`,
      n: counter,
      seq: seqCounter,
      request,
      summary,
      ops,
      stableOps,
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
    return reapplyEntry(entry);
  }

  // ---------------------------------------------------------------------
  // Modo original
  // ---------------------------------------------------------------------

  function toggleOriginal() {
    if (!originalMode) {
      toggledEntries = history.filter((e) => !e.undone);
      toggledPresets = presetsApplied.slice();
      const newestFirst = [...toggledEntries, ...toggledPresets].sort((a, b) => b.seq - a.seq);
      for (const item of newestFirst) undoRecords(item.records);
      originalMode = true;
    } else {
      const oldestFirst = [...toggledEntries, ...toggledPresets].sort((a, b) => a.seq - b.seq);
      const presetSet = new Set(toggledPresets);
      for (const item of oldestFirst) {
        if (presetSet.has(item)) reapplyPreset(item);
        else reapplyEntry(item);
      }
      toggledEntries = [];
      toggledPresets = [];
      originalMode = false;
    }
  }

  // ---------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------

  // `auto` marca que a aplicação veio do auto-aplicar do carregamento da
  // página (e não de um "Aplicar agora" do popup/sidebar) — é o que decide se
  // o indicador oferece "Desligar auto-aplicar".
  function applyPreset(preset, { auto = false } = {}) {
    // No modo original o DOM está revertido: aplicar aqui escreveria por cima
    // do "original" que o usuário pediu para ver, e o dedup abaixo desfaria
    // records que `toggleOriginal` já reverteu (undo duplo). Recusa em silêncio.
    if (originalMode) {
      return { applied: 0, total: (preset.ops || []).length, missing: [] };
    }
    // Reaplicar um preset já aplicado não pode empilhar uma segunda cópia:
    // desfaz a aplicação anterior e reaplica, para que "Aplicar agora"
    // reflita a versão atual do preset salvo.
    const previousIdx = presetsApplied.findIndex((p) => p.id === preset.id);
    if (previousIdx !== -1) {
      const previous = presetsApplied[previousIdx];
      undoRecords(previous.records);
      presetsApplied.splice(previousIdx, 1);
      toggledPresets = toggledPresets.filter((p) => p !== previous);
    }

    const stableOps = preset.ops;
    const records = applyOps(stableOps, doc, opts);
    const applied = records.filter((r) => r.matched > 0).length;
    const total = stableOps.length;
    const missing = records.filter((r) => r.matched === 0).map((r) => r.op.selector);
    seqCounter += 1;
    presetsApplied.push({
      id: preset.id,
      seq: seqCounter,
      name: preset.name,
      stableOps,
      records,
      applied,
      total,
      auto: auto === true,
    });
    return { applied, total, missing };
  }

  function collectPresetOps() {
    return history.filter((e) => !e.undone).flatMap((e) => e.stableOps);
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
    // `applied`, não `total`: ops de preset cujo seletor não casou não mudaram
    // nada na página e não podem aparecer no "N alterações" do indicador.
    const presetsSum = presetsApplied.reduce((sum, p) => sum + p.applied, 0);
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
      autoApplied: presetsApplied.some((p) => p.auto),
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
