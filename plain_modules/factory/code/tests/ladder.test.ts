import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateLadder } from "../packages/core/src/ladder.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const rung = { name: "first", model: "claude-sonnet", effort: "low" };
const valid = { name: "review", rungs: [rung] };

test("ladder schema validates all rungs and unique names", () => {
  for (const effort of ["low", "medium", "high", "max"])
    assert.equal(
      validateLadder({ ...valid, rungs: [{ ...rung, effort }] }).name,
      "review",
    );
  for (const bad of [
    {},
    { ...valid, name: "" },
    { ...valid, rungs: [] },
    { ...valid, rungs: "no" },
    { ...valid, rungs: [{ ...rung, name: "" }] },
    { ...valid, rungs: [{ ...rung, model: "gpt" }] },
    { ...valid, rungs: [{ ...rung, effort: "maximum" }] },
    { ...valid, rungs: [rung, rung] },
  ])
    assert.throws(() => validateLadder(bad));
  assert.equal(
    validateLadder({ ...valid, rungs: [rung, { ...rung, name: "second" }] })
      .rungs.length,
    2,
  );
});

test("check-ladder reads YAML and reports missing or invalid files", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-ladder-"));
  try {
    const path = join(root, "ladder.yaml");
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [cli, "definition", "check-ladder", ...args],
        { encoding: "utf8" },
      );
    assert.notEqual(run().status, 0);
    assert.match(run(path).stderr, /ladder\.yaml/);
    writeFileSync(path, "name: [\n");
    assert.notEqual(run(path).status, 0);
    writeFileSync(
      path,
      "name: review\nrungs:\n  - name: first\n    model: claude-sonnet\n    effort: high\n",
    );
    const result = run(path);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Ladder valid: review\n");
    writeFileSync(path, JSON.stringify({ ...valid, rungs: [rung, rung] }));
    const invalid = run(path);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /unique/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
