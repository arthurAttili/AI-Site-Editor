import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";

test("jsdom funciona", () => {
  const { doc } = makeDoc("<body><p id='a'>oi</p></body>");
  assert.equal(doc.getElementById("a").textContent, "oi");
});
