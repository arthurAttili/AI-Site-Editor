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
test("remove href com tab ou LF dentro do esquema (bypass jav<TAB>ascript:)", () => {
  const { doc } = makeDoc();
  assert.equal(sanitizeHTML(`<a href="jav\tascript:alert(1)">a</a>`, doc), `<a>a</a>`);
  assert.equal(sanitizeHTML(`<a href="java\nscript:alert(1)">a</a>`, doc), `<a>a</a>`);
});
test("remove xlink:href com javascript: em svg", () => {
  const { doc } = makeDoc();
  assert.equal(sanitizeHTML(`<svg><a xlink:href="javascript:alert(1)">x</a></svg>`, doc), `<svg><a>x</a></svg>`);
});
test("remove src com esquema em maiúsculas", () => {
  const { doc } = makeDoc();
  assert.equal(sanitizeHTML(`<img src="JAVASCRIPT:x">`, doc), `<img>`);
});
test("mantém xlink:href são dentro de svg", () => {
  const { doc } = makeDoc();
  assert.equal(sanitizeHTML(`<svg><a xlink:href="https://x.com">x</a></svg>`, doc), `<svg><a xlink:href="https://x.com">x</a></svg>`);
});
