import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText;
const exports = {};
new Function("exports", "React", "require", compiled)(exports, React, require);

async function render(fetchImpl) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const root = createRoot(document.getElementById("root"));
  const params = Promise.resolve({ project: "sample" });
  await act(async () => {
    root.render(React.createElement(exports.default, { params }));
  });
  return {
    html: document.body.innerHTML,
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = previousFetch;
      dom.window.close();
    },
  };
}

test("renders tasks in API order with a home link and no editing controls", async () => {
  let requested;
  const view = await render(async (url) => {
    requested = url;
    return Response.json([
      { id: "first", prompt: "one", stage: "queued" },
      { id: "second", prompt: "two", stage: "queued" },
    ]);
  });
  assert.equal(requested, "/api/projects/sample/tasks");
  assert.match(view.html, /<h1>Tasks: sample<\/h1>/);
  assert.match(view.html, /href="\/"/);
  assert.match(
    view.html,
    /<td>first<\/td><td>one<\/td><td>queued<\/td>.*<td>second<\/td><td>two<\/td><td>queued<\/td>/,
  );
  assert.doesNotMatch(view.html, /<(button|input|textarea|select)\b/);
  await view.close();
});

test("shows the empty state only for a successful empty list", async () => {
  const view = await render(async () => Response.json([]));
  assert.match(view.html, /No tasks yet/);
  assert.doesNotMatch(view.html, /Tasks unavailable/);
  await view.close();
});

test("shows unavailable for HTTP and network failures", async () => {
  for (const fetchImpl of [
    async () => new Response("unavailable", { status: 503 }),
    async () => {
      throw new Error("network");
    },
  ]) {
    const view = await render(fetchImpl);
    assert.match(view.html, /Tasks unavailable/);
    assert.doesNotMatch(view.html, /No tasks yet/);
    await view.close();
  }
});
