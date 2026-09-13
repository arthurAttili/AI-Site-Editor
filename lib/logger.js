// lib/logger.js — formatador de log para o Console do DevTools
// Módulo ES puro: console é injetado via createLogger(console)

export function createLogger(consoleObj) {
  /**
   * Truncate a string to 120 characters with ellipsis if needed
   */
  function truncate(str) {
    if (!str || str.length <= 120) return str;
    return str.substring(0, 120) + "…";
  }

  /**
   * Format milliseconds to pt-BR format (e.g., 2100 ms → "2,1 s")
   * Locale-independent: uses .toFixed(1) and manual comma replacement
   */
  function formatDuration(ms) {
    if (typeof ms !== "number" || !isFinite(ms)) return "";
    return (ms / 1000).toFixed(1).replace(".", ",") + " s";
  }

  /**
   * Log a request with its changes
   */
  function request({ n, request: requestText, targets = [], provider, model, ms, records = [], summary } = {}) {
    const prefix = `[Editor IA] Pedido #${n} — "${requestText}"`;
    consoleObj.group(prefix);

    try {
      // Log targets
      if (targets && targets.length > 0) {
        const targetsList = targets.map((t) => `${t.id} = ${t.label}`).join(", ");
        consoleObj.log(`Alvos: ${targetsList}`);
      }

      // Log provider, model, and duration
      const segments = [provider, model, formatDuration(ms)].filter(Boolean);
      consoleObj.log(segments.join(" · "));

      // Log summary if present
      if (summary) {
        consoleObj.log(`Resumo: ${summary}`);
      }

      // Log each record
      if (records && records.length > 0) {
        for (const record of records) {
          if (!record) continue; // Skip null/undefined records
          if (record.warning) {
            // Log warning for this record
            const op = record.op || {};
            consoleObj.warn(`⚠ ${op.op} ${op.selector} — ${record.warning}`);
          } else {
            // Log successful changes
            if (record.changes && record.changes.length > 0) {
              for (const change of record.changes) {
                if (!change) continue; // Skip null/undefined changes
                const op = record.op || {};
                const target = change.target || "";
                const name = op.name ? ` ${op.name}` : "";
                const before = truncate(change.before || "");
                const after = truncate(change.after || "");

                if (before !== undefined && after !== undefined) {
                  consoleObj.log(`✔ ${op.op} ${target}${name}: "${before}" → "${after}"`);
                } else {
                  consoleObj.log(`✔ ${op.op} ${target}`);
                }
              }
            } else {
              // No changes but no warning either
              const op = record.op || {};
              consoleObj.log(`✔ ${op.op} (sem alterações)`);
            }
          }
        }
      }
    } finally {
      consoleObj.groupEnd();
    }
  }

  /**
   * Log an error
   */
  function error({ n, request: requestText, message } = {}) {
    const msg = `[Editor IA] Pedido #${n} — "${requestText}" falhou: ${message}`;
    consoleObj.error(msg);
  }

  /**
   * Log an undo action
   */
  function undo({ n, request: requestText } = {}) {
    const msg = `[Editor IA] Desfeito o pedido #${n} — "${requestText}"`;
    consoleObj.log(msg);
  }

  /**
   * Log preset application
   */
  function preset({ name, applied = 0, total = 0, missing = [] } = {}) {
    const msg = `[Editor IA] Preset "${name}" aplicado: ${applied}/${total} operações`;
    consoleObj.log(msg);

    if (missing && missing.length > 0) {
      const missingList = missing.join(", ");
      consoleObj.warn(`Seletores não encontrados: ${missingList}`);
    }
  }

  /**
   * Aviso de "site modificado". Sai como console.info, não console.warn: o
   * Chrome coleta todo warn/error de content scripts na aba "Erros" de
   * chrome://extensions, e este aviso proposital aparecia lá como se fosse
   * uma falha da extensão. No Console do DevTools ele continua visível.
   */
  function modifiedWarning({ activeCount = 0, presetNames = [] } = {}) {
    const msg = `[Editor IA] Este site está MODIFICADO por você (${activeCount} alterações ativas${
      presetNames && presetNames.length > 0 ? `, presets: ${presetNames.join(", ")}` : ""
    }) — não é a versão original do site.`;
    consoleObj.info(msg);
  }

  /**
   * Log original mode toggle
   */
  function originalMode(on) {
    const msg = `[Editor IA] Modo ORIGINAL ${on ? "ligado — alterações desligadas temporariamente" : "desligado — alterações reaplicadas"}`;
    consoleObj.log(msg);
  }

  return {
    request,
    error,
    undo,
    preset,
    modifiedWarning,
    originalMode,
  };
}
