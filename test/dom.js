import { JSDOM } from "jsdom";

export function makeDoc(html = "<body></body>") {
  const dom = new JSDOM(`<!doctype html><html>${html}</html>`, { pretendToBeVisual: true });
  return { dom, doc: dom.window.document, win: dom.window };
}
