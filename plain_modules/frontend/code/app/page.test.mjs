import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const names = require("../resources/frontend-component-placeholders.json");

function renderHome() {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  new Function("exports", "React", "require", compiled)(
    exports,
    React,
    require,
  );
  return renderToStaticMarkup(React.createElement(exports.default));
}

test("home page renders the Software Factory heading", () => {
  assert.match(renderHome(), /<h1>Software Factory<\/h1>/);
});

test("section navigation uses keyboard-accessible links to the corresponding content", () => {
  const html = renderHome();
  const nav = html.match(/<nav aria-label="Page sections">(.*?)<\/nav>/)?.[1];
  assert.ok(nav);
  assert.match(nav, /<a href="#components">Components<\/a>/);
  assert.match(nav, /<a href="#data-contracts">Data contracts<\/a>/);
  assert.match(
    html,
    /<section id="components"[^>]*>.*<h2[^>]*>Components<\/h2>.*<div class="card-grid">/,
  );
  assert.match(
    html,
    /<section id="data-contracts"[^>]*>\s*<h2[^>]*>Data contracts<\/h2>\s*<p>Not connected to backend<\/p>\s*<\/section>/,
  );
});

test("each component has one non-interactive disconnected card", () => {
  const html = renderHome();
  const cards = [...html.matchAll(/<article\b[^>]*>(.*?)<\/article>/g)].map(
    (match) => match[1],
  );
  assert.equal(cards.length, names.length);
  for (const name of names) {
    const matches = cards.filter((card) => card.includes(`<h3>${name}</h3>`));
    assert.equal(matches.length, 1, name);
    assert.match(matches[0], /<p>Not connected<\/p>/);
    assert.doesNotMatch(matches[0], /<(button|a|input|select|textarea)\b/i);
  }
});
