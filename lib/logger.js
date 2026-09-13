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
   */
  function formatDuration(ms) {
    const seconds = ms / 1000;
    return seconds.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  /**
   * Log a request with its changes
   */
  function request({ n, request: requestText, targets = [], provider, model, ms, records = [], summary } = {}) {
    const prefix = `[Editor IA] Pedido #${n} — "${requestText}"`;
    consoleObj.group(prefix);

    // Log targets
    if (targets && targets.length > 0) {
      const targetsList = targets.map((t) => `${t.id} = ${t.label}`).join(", ");
      consoleObj.log(`Alvos: ${targetsList}`);
    }

    // Log provider, model, and duration
    const duration = formatDuration(ms);
    consoleObj.log(`${provider} · ${model} · ${duration} s`);

    // Log summary if present
    if (summary) {
      consoleObj.log(`Resumo: ${summary}`);
    }

    // Log each record
    if (records && records.length > 0) {
      for (const record of records) {
        if (record.warning) {
          // Log warning for this record
          const op = record.op || {};
          consoleObj.warn(`⚠ ${op.op} ${op.selector} — ${record.warning}`);
        } else {
          // Log successful changes
          if (record.changes && record.changes.length > 0) {
            for (const change of record.changes) {
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
            consoleObj.log(`✔ ${op.op} ${record.target || ""}`);
          }
        }
      }
    }

    consoleObj.groupEnd();
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
   * Log modified warning
   */
  function modifiedWarning({ activeCount = 0, presetNames = [] } = {}) {
    let msg = `[Editor IA] Este site está MODIFICADO por você (${activeCount} alterações ativas`;
    if (presetNames && presetNames.length > 0) {
      msg += `, presets: ${presetNames.join(", ")}`;
    }
    msg += ") — não é a versão original do site.";
    consoleObj.warn(msg);
  }

  /**
   * Log original mode toggle
   */
  function originalMode(on) {
    let msg = `[Editor IA] Modo ORIGINAL ${on ? "ligado — alterações desligadas temporariamente" : "desligado — alterações reaplicadas"}`;
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
