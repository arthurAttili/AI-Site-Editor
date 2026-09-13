import test from "node:test";
import assert from "node:assert/strict";
import { OPS_SCHEMA, buildPrompt } from "../lib/prompt.js";
import { OP_TYPES } from "../lib/ops.js";

test("schema estrito e plano", () => {
  assert.equal(OPS_SCHEMA.additionalProperties, false);
  assert.deepEqual(OPS_SCHEMA.required, ["summary", "ops"]);
  const item = OPS_SCHEMA.properties.ops.items;
  assert.deepEqual(item.required, ["op", "selector", "name", "value", "position"]);
  assert.deepEqual(item.properties.op.enum, OP_TYPES);
});
test("prompt inclui seleção, histórico recente e idioma", () => {
  const history = Array.from({ length: 12 }, (_, i) => ({ request: `pedido ${i}`, summary: `res ${i}` }));
  const { system, user } = buildPrompt({
    language: "pt-BR", url: "https://x.com/a", title: "X",
    selection: [{ id: "s1", tag: "button", selector: "button.x", label: "button.x", ancestors: "body > div", html: "<button data-aise-id=\"s1\">ok</button>", styles: { color: "red" } }],
    history, request: "deixe vermelho",
  });
  assert.match(system, /pt-BR/);
  assert.match(system, /data-aise-id/);
  assert.match(system, /injectCSS/);
  assert.ok(user.includes("https://x.com/a"));
  assert.ok(user.includes("[s1]"));
  assert.ok(user.includes("pedido 11") && !user.includes("pedido 1\n"));
  assert.ok(user.trim().endsWith("deixe vermelho"));
});
