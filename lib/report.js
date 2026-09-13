// lib/report.js — relatório de handoff da sessão de edição, em Markdown.
//
// O texto é pensado para ser colado numa outra IA (Claude Code, por exemplo)
// que trabalha no código-fonte do site: carrega o pedido do usuário, como o
// modelo resolveu, o elemento alvo (seletor, caminho, HTML antes e depois) e
// cada operação aplicada no DOM. Módulo ES puro: recebe só dados
// (`session.exportHistory()` / `session.exportPresets()`), sem tocar em DOM.

const INLINE_MAX = 300;
const BLOCK_MAX = 1500;
const CUT = "…[cortado]";

const BLOCK_OPS = new Set(["setHTML", "insertHTML", "remove", "injectCSS"]);

function pad(n) {
  return String(n).padStart(2, "0");
}

// "AAAA-MM-DD HH:MM" no fuso local — legível e estável em qualquer locale.
export function formatDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cut(str, max) {
  const s = str == null ? "" : String(str);
  return s.length > max ? s.slice(0, max) + CUT : s;
}

function inline(value) {
  return JSON.stringify(cut(value, INLINE_MAX).replace(/\s+/g, " ").trim());
}

function fence(lang, value) {
  const body = cut(value, BLOCK_MAX);
  return ["```" + lang, body, "```"].join("\n");
}

function code(value) {
  return "`" + String(value == null ? "" : value).replace(/`/g, "\\`") + "`";
}

// Uma linha (ou bloco) por operação, sempre a partir do que de fato mudou.
function describeRecord(record) {
  const op = record.op || {};
  const sel = code(op.selector);
  if (record.warning) {
    return [`- ⚠ ${op.op} em ${sel} — não aplicada: ${record.warning}`];
  }
  const changes = record.changes || [];
  const lines = [];
  switch (op.op) {
    case "setStyle":
    case "setAttr":
    case "removeAttr":
      for (const c of changes) {
        let line = `- ${op.op} em ${sel}: ${code(op.name)} ${inline(c.before)} → ${inline(c.after)}`;
        // O DOM devolve valores normalizados (ex.: "#d32f2f" vira "rgb(211, 47, 47)");
        // o valor pedido pela IA é o que interessa para o código-fonte.
        if (op.op !== "removeAttr" && op.value != null && String(op.value) !== String(c.after)) line += ` (valor pedido: ${inline(op.value)})`;
        lines.push(line);
      }
      break;
    case "addClass":
    case "removeClass":
      for (const c of changes) lines.push(`- ${op.op} ${inline(op.value)} em ${sel} (class: ${inline(c.before)} → ${inline(c.after)})`);
      break;
    case "setText":
      for (const c of changes) lines.push(`- setText em ${sel}: ${inline(c.before)} → ${inline(c.after)}`);
      break;
    case "setHTML":
      for (const c of changes) {
        lines.push(`- setHTML em ${sel} — conteúdo antes:`, fence("html", c.before), "  conteúdo depois:", fence("html", c.after));
      }
      break;
    case "insertHTML":
      lines.push(`- insertHTML (${op.position}) em ${sel} — HTML inserido:`, fence("html", op.value));
      break;
    case "remove":
      for (const c of changes) lines.push(`- remove ${sel} — elemento removido:`, fence("html", c.before));
      break;
    case "injectCSS":
      lines.push("- injectCSS — CSS adicionado à página:", fence("css", op.value));
      break;
    default:
      lines.push(`- ${op.op} em ${sel}`);
  }
  if (lines.length === 0) {
    lines.push(`- ${op.op} em ${sel} (${record.matched || 0} elemento(s), sem mudança de valor)`);
  }
  return lines;
}

function describeTarget(t) {
  const lines = [`**Elemento ${t.id}** — ${code(t.label)} — seletor: ${code(t.selector)}`];
  if (t.ancestors) lines.push(`Caminho: ${code(t.ancestors)}`);
  if (t.htmlBefore) lines.push("HTML antes:", fence("html", t.htmlBefore));
  if (t.htmlAfter && t.htmlAfter !== t.htmlBefore) lines.push("HTML depois:", fence("html", t.htmlAfter));
  return lines;
}

function describeEntry(e) {
  const lines = [`## Pedido ${e.n} — «${(e.request || "").trim()}»`, ""];
  if (e.summary) lines.push(`**Como foi resolvido:** ${e.summary}`, "");
  for (const t of e.targets || []) lines.push(...describeTarget(t), "");
  lines.push("**Operações aplicadas no DOM:**");
  const records = e.records || [];
  if (records.length === 0) lines.push("- (nenhuma)");
  for (const r of records) lines.push(...describeRecord(r));
  lines.push("");
  return lines;
}

export const CONTEXT_TEXT = [
  "## Contexto para quem for aplicar",
  "",
  "Estas alterações foram feitas ao vivo no DOM da página publicada, com a extensão aiSiteEditor, durante uma revisão com o cliente. Elas **não estão no código-fonte**: a tarefa é reproduzir cada pedido abaixo no código do site.",
  "",
  "Para cada pedido:",
  "1. Localize no código-fonte o componente/template/estilo que gera o elemento indicado — use o seletor, o caminho de ancestrais e o HTML como pista (o DOM renderizado pode diferir do fonte).",
  "2. Implemente a mudança do jeito idiomático do projeto (classe/token de design em vez de estilo inline, texto no arquivo de conteúdo ou i18n, componente reutilizado em vez de HTML solto).",
  "3. Use as \"operações aplicadas no DOM\" como especificação do resultado esperado, não como código a copiar.",
  "",
  "Pedidos desfeitos pelo usuário foram omitidos: só o que está listado deve ir para o código.",
  "",
].join("\n");

export function buildReport({ origin = "", url = "", title = "", generatedAt, history = [], presets = [] } = {}) {
  const active = history.filter((e) => !e.undone);
  const undoneCount = history.length - active.length;
  const lines = [];
  lines.push(`# Ajustes solicitados — ${title || origin || url || "página"}`, "");
  lines.push(`- Site: ${origin || "?"}`);
  lines.push(`- Página: ${url || "?"}`);
  if (title) lines.push(`- Título: ${title}`);
  const when = formatDate(generatedAt instanceof Date ? generatedAt : new Date(generatedAt || NaN));
  if (when) lines.push(`- Gerado em: ${when}`);
  lines.push(`- Pedidos a aplicar: ${active.length}${undoneCount ? ` (${undoneCount} desfeito(s), omitido(s))` : ""}`);
  lines.push("");
  lines.push(CONTEXT_TEXT);
  if (active.length === 0) {
    lines.push("_Nenhum pedido ativo nesta sessão._", "");
  }
  for (const e of active) lines.push(...describeEntry(e));

  const applied = presets.filter((p) => (p.records || []).some((r) => r.matched > 0));
  if (applied.length > 0) {
    lines.push("## Presets já aplicados nesta página", "");
    lines.push("Alterações salvas em sessões anteriores e reaplicadas automaticamente. Confira se já estão no código; se não, tratá-las como pedidos.", "");
    for (const p of applied) {
      lines.push(`### Preset «${p.name}» (${p.applied}/${p.total} operações aplicadas)`);
      for (const r of p.records || []) lines.push(...describeRecord(r));
      lines.push("");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
