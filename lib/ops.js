// lib/ops.js — aplicar e desfazer operações de edição de DOM.
// Módulo ES puro: nada de `document`/`chrome` globais — tudo entra via `doc`.

export const OP_TYPES = [
  "setStyle",
  "setAttr",
  "removeAttr",
  "addClass",
  "removeClass",
  "setText",
  "setHTML",
  "insertHTML",
  "remove",
  "injectCSS",
];

const INSERT_POSITIONS = ["beforebegin", "afterbegin", "beforeend", "afterend"];

const STRING_FIELDS = ["op", "selector", "name", "value", "position"];

function normalizeOp(raw) {
  const out = {};
  for (const field of STRING_FIELDS) {
    const v = raw && raw[field];
    out[field] = typeof v === "string" ? v : "";
  }
  return out;
}

function validateOne(op) {
  if (!OP_TYPES.includes(op.op)) {
    return `operação "${op.op}" desconhecida`;
  }
  if (op.position !== "" && op.op !== "insertHTML") {
    return `"position" só é válido em insertHTML`;
  }
  if (op.op === "insertHTML" && !INSERT_POSITIONS.includes(op.position)) {
    return `"position" inválida para insertHTML: "${op.position}"`;
  }
  if ((op.op === "setStyle" || op.op === "setAttr" || op.op === "removeAttr") && op.name === "") {
    return `operação "${op.op}" exige "name"`;
  }
  if (
    ["addClass", "removeClass", "setText", "setHTML", "insertHTML", "injectCSS"].includes(op.op) &&
    op.value === ""
  ) {
    return `operação "${op.op}" exige "value"`;
  }
  return null;
}

export function validateOps(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw && raw.ops) ? raw.ops : [];
  const ops = [];
  const errors = [];
  for (const rawOp of list) {
    const op = normalizeOp(rawOp);
    const reason = validateOne(op);
    if (reason) {
      errors.push(reason);
    } else {
      ops.push(op);
    }
  }
  return { ops, errors };
}

function queryNodes(doc, selector) {
  try {
    return { nodes: Array.from(doc.querySelectorAll(selector)), warning: null };
  } catch {
    return { nodes: [], warning: `seletor "${selector}" inválido` };
  }
}

function makeRecord(op, matched, changes, warning, undo) {
  return { op, matched, changes, warning, undo };
}

function applySimpleOp(op, doc, opts) {
  const { nodes, warning: invalidWarning } = queryNodes(doc, op.selector);
  if (invalidWarning) {
    return makeRecord(op, 0, [], invalidWarning, () => {});
  }
  if (nodes.length === 0) {
    return makeRecord(op, 0, [], `seletor "${op.selector}" não encontrou elementos`, () => {});
  }

  const changes = [];
  const undoFns = [];

  for (const el of nodes) {
    switch (op.op) {
      case "setStyle": {
        const before = el.style.getPropertyValue(op.name);
        el.style.setProperty(op.name, op.value);
        const after = el.style.getPropertyValue(op.name);
        changes.push({ target: op.selector, before, after });
        undoFns.push(() => {
          if (before === "") el.style.removeProperty(op.name);
          else el.style.setProperty(op.name, before);
        });
        break;
      }
      case "setAttr": {
        const before = el.getAttribute(op.name);
        el.setAttribute(op.name, op.value);
        changes.push({ target: op.selector, before: before === null ? "" : before, after: op.value });
        undoFns.push(() => {
          if (before === null) el.removeAttribute(op.name);
          else el.setAttribute(op.name, before);
        });
        break;
      }
      case "removeAttr": {
        const before = el.getAttribute(op.name);
        el.removeAttribute(op.name);
        changes.push({ target: op.selector, before: before === null ? "" : before, after: "" });
        undoFns.push(() => {
          if (before !== null) el.setAttribute(op.name, before);
        });
        break;
      }
      case "addClass": {
        const had = el.classList.contains(op.value);
        const before = el.className;
        el.classList.add(op.value);
        changes.push({ target: op.selector, before, after: el.className });
        undoFns.push(() => {
          if (!had) el.classList.remove(op.value);
        });
        break;
      }
      case "removeClass": {
        const had = el.classList.contains(op.value);
        const before = el.className;
        el.classList.remove(op.value);
        changes.push({ target: op.selector, before, after: el.className });
        undoFns.push(() => {
          if (had) el.classList.add(op.value);
        });
        break;
      }
      case "setText": {
        const before = el.textContent;
        el.textContent = op.value;
        changes.push({ target: op.selector, before, after: op.value });
        undoFns.push(() => {
          el.textContent = before;
        });
        break;
      }
      case "setHTML": {
        const before = el.innerHTML;
        const html = opts && typeof opts.sanitize === "function" ? opts.sanitize(op.value) : op.value;
        el.innerHTML = html;
        changes.push({ target: op.selector, before, after: el.innerHTML });
        undoFns.push(() => {
          el.innerHTML = before;
        });
        break;
      }
      case "remove": {
        const parent = el.parentNode;
        const next = el.nextSibling;
        const before = el.outerHTML;
        parent.removeChild(el);
        changes.push({ target: op.selector, before, after: "" });
        undoFns.push(() => {
          parent.insertBefore(el, next);
        });
        break;
      }
      case "insertHTML": {
        const html = opts && typeof opts.sanitize === "function" ? opts.sanitize(op.value) : op.value;
        const template = doc.createElement("template");
        template.innerHTML = html;
        const inserted = Array.from(template.content.childNodes);
        el.insertAdjacentHTML(op.position, html);
        // Localiza os nós recém-inseridos comparando com os originais do template.
        const insertedNodes = locateInsertedNodes(el, op.position, inserted.length);
        changes.push({ target: op.selector, before: "", after: html });
        undoFns.push(() => {
          for (const node of insertedNodes) {
            if (node.parentNode) node.parentNode.removeChild(node);
          }
        });
        break;
      }
      default:
        break;
    }
  }

  return makeRecord(op, nodes.length, changes, undefined, () => {
    for (let i = undoFns.length - 1; i >= 0; i--) undoFns[i]();
  });
}

function locateInsertedNodes(el, position, count) {
  if (count === 0) return [];
  switch (position) {
    case "beforebegin": {
      const nodes = [];
      let cur = el.previousSibling;
      for (let i = 0; i < count && cur; i++) {
        nodes.unshift(cur);
        cur = cur.previousSibling;
      }
      return nodes;
    }
    case "afterbegin": {
      const nodes = [];
      let cur = el.firstChild;
      for (let i = 0; i < count && cur; i++) {
        nodes.push(cur);
        cur = cur.nextSibling;
      }
      return nodes;
    }
    case "beforeend": {
      const nodes = [];
      let cur = el.lastChild;
      for (let i = 0; i < count && cur; i++) {
        nodes.unshift(cur);
        cur = cur.previousSibling;
      }
      return nodes;
    }
    case "afterend": {
      const nodes = [];
      let cur = el.nextSibling;
      for (let i = 0; i < count && cur; i++) {
        nodes.push(cur);
        cur = cur.nextSibling;
      }
      return nodes;
    }
    default:
      return [];
  }
}

function applyInjectCSS(op, doc) {
  let head = doc.head;
  if (!head) {
    head = doc.createElement("head");
    doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
  }
  const style = doc.createElement("style");
  style.setAttribute("data-aise", "1");
  style.textContent = op.value;
  head.appendChild(style);
  const changes = [{ target: op.selector, before: "", after: op.value }];
  return makeRecord(op, 1, changes, undefined, () => {
    if (style.parentNode) style.parentNode.removeChild(style);
  });
}

export function applyOp(op, doc, opts) {
  if (op.op === "injectCSS") {
    return applyInjectCSS(op, doc);
  }
  return applySimpleOp(op, doc, opts);
}

export function applyOps(ops, doc, opts) {
  return ops.map((op) => applyOp(op, doc, opts));
}

export function undoRecords(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    records[i].undo();
  }
}

export function redoRecords(records, doc, opts) {
  return applyOps(records.map((r) => r.op), doc, opts);
}
