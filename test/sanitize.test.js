import test from "node:test";
import assert from "node:assert/strict";
import { makeDoc } from "./dom.js";
import { sanitizeHTML, isSafeAttribute } from "../lib/sanitize.js";
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

test("remove base, meta e link (sequestro de destino, refresh e folha de estilo)", () => {
  const { doc } = makeDoc();
  const out = sanitizeHTML(
    `<base href="https://mau.example/"><meta http-equiv="refresh" content="0;url=https://mau.example/"><link rel="stylesheet" href="https://mau.example/x.css"><p>ok</p>`,
    doc
  );
  assert.equal(out, `<p>ok</p>`);
});

test("remove template, inclusive com script dentro", () => {
  const { doc } = makeDoc();
  const out = sanitizeHTML(`<template><script>alert(1)</script></template><b>b</b>`, doc);
  assert.equal(out, `<b>b</b>`);
  assert.equal(out.includes("script"), false);
});

test("remove os elementos SVG de animação (animate, set, animateTransform, animateMotion)", () => {
  const { doc } = makeDoc();
  const out = sanitizeHTML(
    `<svg><a><animate attributeName="href" to="javascript:alert(1)"></animate><set attributeName="href" to="javascript:alert(1)"></set><animateTransform attributeName="transform"></animateTransform><animateMotion></animateMotion></a></svg>`,
    doc
  );
  assert.equal(out.toLowerCase().includes("animate"), false);
  assert.equal(out.toLowerCase().includes("<set"), false);
});

test("remove srcdoc e style perigoso, mantém style normal", () => {
  const { doc } = makeDoc();
  const out = sanitizeHTML(
    `<div srcdoc="<script>x</script>" style="width:expression(alert(1))"></div><p style="color:red">p</p>`,
    doc
  );
  assert.equal(out, `<div></div><p style="color:red">p</p>`);
});

test("isSafeAttribute recusa on*, srcdoc, javascript: e style perigoso", () => {
  assert.equal(isSafeAttribute("onclick", "x()"), false);
  assert.equal(isSafeAttribute("ONCLICK", "x()"), false);
  assert.equal(isSafeAttribute("srcdoc", "<b>x</b>"), false);
  assert.equal(isSafeAttribute("href", " jav\tascript:alert(1)"), false);
  assert.equal(isSafeAttribute("xlink:href", "javascript:alert(1)"), false);
  assert.equal(isSafeAttribute("formaction", "javascript:alert(1)"), false);
  assert.equal(isSafeAttribute("style", "width: expression(alert(1))"), false);
  assert.equal(isSafeAttribute("style", "background: url( javascript:alert(1) )"), false);
  assert.equal(isSafeAttribute("style", "-moz-binding: url(x.xml)"), false);

  assert.equal(isSafeAttribute("href", "https://ok.example/"), true);
  assert.equal(isSafeAttribute("style", "color: red"), true);
  assert.equal(isSafeAttribute("class", "onibus"), true);
  assert.equal(isSafeAttribute("data-one", "x"), true);
});
