import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { sanitizeHTML } from "../lib/sanitize.js";
test("remove script, on* e javascript:", () => {
  const { doc } = makeDoc();
  const out = sanitizeHTML(`<a href=" JavaScript:alert(1)" onclick="x()">a</a><script>1</script><b>b</b><iframe src="x"></iframe>`, doc);
  assert.equal(out, `<a>a</a><b>b</b>`);
});
test("mantém href normal e estilos", () => {
  const { doc } = makeDoc();
  assert.equal(sanitizeHTML(`<a href="/x" style="color:red">a</a>`, doc), `<a href="/x" style="color:red">a</a>`);
});
