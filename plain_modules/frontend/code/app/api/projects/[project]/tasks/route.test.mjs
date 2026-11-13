import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const exports = {};
new Function("exports", "require", compiled)(
  exports,
  createRequire(import.meta.url),
);
const { GET } = exports;
const call = (project) =>
  GET(new Request("http://localhost"), {
    params: Promise.resolve({ project }),
  });

test("task list validates projects, executes the CLI, and validates its records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "task-test-"));
  const script = join(dir, "cli.cjs");
  const previous = { ...process.env };
  try {
    await writeFile(
      script,
      `if (process.argv.slice(2).join(' ') !== 'task list --project demo-1' || process.env.FACTORY_ROOT !== 'root') process.exit(2); console.log(JSON.stringify([{id:'123e4567-e89b-12d3-a456-426614174000', project:'demo-1', repo:'repo', prompt:'prompt', stage:'queued', extra:true}]));`,
    );
    process.env.FACTORY_CLI_SCRIPT = script;
    process.env.FACTORY_ROOT = "root";
    let response = await call("demo-1");
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].extra, true);
    response = await call("bad name");
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_project" });
    for (const output of ["not json", JSON.stringify([{ id: "bad" }])]) {
      await writeFile(script, `console.log(${JSON.stringify(output)})`);
      response = await call("demo-1");
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "task_source_unavailable",
      });
    }
    await writeFile(script, "console.error('secret path'); process.exit(1)");
    assert.equal((await call("demo-1")).status, 503);
    process.env.FACTORY_CLI_SCRIPT = "relative";
    assert.equal((await call("demo-1")).status, 503);
    delete process.env.FACTORY_CLI_SCRIPT;
    assert.equal((await call("demo-1")).status, 503);
  } finally {
    process.env = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
