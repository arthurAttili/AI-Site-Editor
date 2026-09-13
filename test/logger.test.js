import test from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../lib/logger.js";

function spyConsole() {
  const calls = [];
  const f = (name) => (...a) => calls.push([name, a.map(String).join(" ")]);
  return { calls, group: f("group"), groupEnd: f("groupEnd"), log: f("log"), warn: f("warn"), error: f("error") };
}

test("request loga grupo com alvos, provedor e mudanças", () => {
  const c = spyConsole();
  const log = createLogger(c);
  log.request({
    n: 3,
    request: "vermelho",
    targets: [{ id: "s1", label: "button.x" }],
    provider: "claude",
    model: "claude-opus-5",
    ms: 2100,
    records: [
      {
        op: { op: "setStyle", selector: "[data-aise-id=\"s1\"]", name: "color" },
        matched: 1,
        changes: [{ target: "button.x", before: "", after: "red" }],
      },
      {
        op: { op: "setText", selector: ".nada" },
        matched: 0,
        changes: [],
        warning: "seletor não encontrou elementos",
      },
    ],
    summary: "ok",
  });
  const text = c.calls.map((x) => x[1]).join("\n");
  assert.match(text, /\[Editor IA\] Pedido #3 — "vermelho"/);
  assert.match(text, /s1 = button.x/);
  assert.match(text, /claude · claude-opus-5 · 2,1 s$/m);
  assert.match(text, /✔ setStyle button.x color: "" → "red"/);
  assert.match(text, /⚠ setText \.nada/);
  assert.equal(c.calls.at(-1)[0], "groupEnd");
});

test("request sem ms não duplica separador", () => {
  const c = spyConsole();
  const log = createLogger(c);
  log.request({
    n: 1,
    request: "teste",
    targets: [],
    provider: "claude",
    model: "claude-opus-5",
    ms: undefined,
    records: [],
  });
  const text = c.calls.map((x) => x[1]).join("\n");
  // Should be exactly "claude · claude-opus-5" with no trailing "·" or " s"
  assert.match(text, /^claude · claude-opus-5$/m);
  assert.equal(c.calls.at(-1)[0], "groupEnd");
});

test("modifiedWarning usa console.warn", () => {
  const c = spyConsole();
  createLogger(c).modifiedWarning({ activeCount: 4, presetNames: ["X"] });
  assert.equal(c.calls[0][0], "warn");
  assert.match(c.calls[0][1], /MODIFICADO por você/);
});

test("error loga mensagem de erro", () => {
  const c = spyConsole();
  createLogger(c).error({ n: 5, request: "teste", message: "conexão falhou" });
  assert.equal(c.calls[0][0], "error");
  assert.match(c.calls[0][1], /\[Editor IA\] Pedido #5 — "teste" falhou: conexão falhou/);
});

test("undo loga desfeito", () => {
  const c = spyConsole();
  createLogger(c).undo({ n: 2, request: "azul" });
  assert.equal(c.calls[0][0], "log");
  assert.match(c.calls[0][1], /\[Editor IA\] Desfeito o pedido #2 — "azul"/);
});

test("preset loga aplicação", () => {
  const c = spyConsole();
  createLogger(c).preset({ name: "tema-escuro", applied: 5, total: 6, missing: [".nao-existe"] });
  assert.equal(c.calls[0][0], "log");
  assert.match(c.calls[0][1], /\[Editor IA\] Preset "tema-escuro" aplicado: 5\/6 operações/);
  assert.equal(c.calls[1][0], "warn");
  assert.match(c.calls[1][1], /\.nao-existe/);
});

test("originalMode loga mudança de modo", () => {
  const c = spyConsole();
  const log = createLogger(c);
  log.originalMode(true);
  assert.equal(c.calls[0][0], "log");
  assert.match(c.calls[0][1], /Modo ORIGINAL ligado/);
  c.calls.length = 0;
  log.originalMode(false);
  assert.equal(c.calls[0][0], "log");
  assert.match(c.calls[0][1], /desligado/);
});

test("trunca strings longas", () => {
  const c = spyConsole();
  const log = createLogger(c);
  const longString = "a".repeat(200);
  log.request({
    n: 1,
    request: "teste",
    targets: [],
    provider: "test",
    model: "test",
    ms: 100,
    records: [
      {
        op: { op: "setText", selector: "p", name: "" },
        matched: 1,
        changes: [{ target: "p", before: longString, after: longString }],
      },
    ],
  });
  const text = c.calls.map((x) => x[1]).join("\n");
  assert.ok(!text.includes(longString));
  assert.match(text, /…/);
});

test("handles missing optional fields safely", () => {
  const c = spyConsole();
  const log = createLogger(c);
  assert.doesNotThrow(() => {
    log.request({ n: 1, request: "test", targets: [], provider: "p", model: "m", ms: 10, records: [] });
  });
  assert.doesNotThrow(() => {
    log.preset({ name: "test", applied: 1, total: 1 });
  });
  assert.doesNotThrow(() => {
    log.modifiedWarning({ activeCount: 1 });
  });
});

test("null records e null changes não lançam, groupEnd garantido", () => {
  const c = spyConsole();
  const log = createLogger(c);
  assert.doesNotThrow(() => {
    log.request({
      n: 1,
      request: "test",
      targets: [],
      provider: "p",
      model: "m",
      ms: 10,
      records: [
        null,
        { op: { op: "setText", selector: "p" }, changes: [null, { target: "p", before: "a", after: "b" }, null] },
        undefined,
      ],
    });
  });
  // Verify groupEnd was called (last call)
  assert.equal(c.calls.at(-1)[0], "groupEnd");
  // Verify no null or undefined leaked into console
  const text = c.calls.map((x) => x[1]).join("\n");
  assert.ok(!text.includes("null"));
  assert.ok(!text.includes("undefined"));
});

test("record com changes vazio e sem warning loga (sem alterações)", () => {
  const c = spyConsole();
  const log = createLogger(c);
  log.request({
    n: 1,
    request: "test",
    targets: [],
    provider: "p",
    model: "m",
    ms: 10,
    records: [{ op: { op: "remove", selector: "p" }, changes: [] }],
  });
  const text = c.calls.map((x) => x[1]).join("\n");
  assert.match(text, /✔ remove \(sem alterações\)/);
  assert.equal(c.calls.at(-1)[0], "groupEnd");
});
