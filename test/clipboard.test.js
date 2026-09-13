import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { copyText } from "../lib/ui/clipboard.js";

test("copyText: usa clipboard.writeText quando disponível", async () => {
  const written = [];
  const clipboard = { writeText: async (t) => written.push(t) };
  const ok = await copyText("olá", { clipboard });
  assert.equal(ok, true);
  assert.deepEqual(written, ["olá"]);
});

test("copyText: cai no execCommand quando writeText falha e limpa o textarea", async () => {
  const { doc } = makeDoc("<body></body>");
  const clipboard = { writeText: async () => { throw new Error("sem foco"); } };
  let copied = null;
  doc.execCommand = (cmd) => {
    if (cmd !== "copy") return false;
    copied = doc.querySelector("textarea").value;
    return true;
  };
  const ok = await copyText("relatório", { clipboard, doc });
  assert.equal(ok, true);
  assert.equal(copied, "relatório");
  assert.equal(doc.querySelector("textarea"), null, "textarea temporário removido");
});

test("copyText: sem clipboard e sem execCommand devolve false; null vira string vazia", async () => {
  assert.equal(await copyText("x", {}), false);
  const { doc } = makeDoc("<body></body>");
  doc.execCommand = () => { throw new Error("bloqueado"); };
  assert.equal(await copyText(null, { doc }), false);
  assert.equal(doc.querySelector("textarea"), null);
});
