import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateLoop } from "../packages/core/src/loop.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const entries = [
  { kind: "step", name: "coder" },
  { kind: "gate", name: "verify" },
  { kind: "step", name: "reviewer" },
  { kind: "gate", name: "human-review" },
  { kind: "gate", name: "decisions-clear" },
  { kind: "gate", name: "open-pr" },
];
const valid = { name: "build", produces_code: true, entries };

test("loop schema validates entries and the ordered code path", () => {
  assert.equal(validateLoop(valid).name, "build");
  assert.equal(
    validateLoop({
      ...valid,
      entries: [
        entries[0],
        { kind: "gate", name: "extra" },
        ...entries.slice(1),
      ],
    }).entries.length,
    7,
  );
  assert.equal(
    validateLoop({
      name: "other",
      produces_code: false,
      entries: [{ kind: "gate", name: "done" }],
    }).name,
    "other",
  );
  for (const bad of [
    {},
    { ...valid, name: "" },
    { ...valid, produces_code: "true" },
    { ...valid, entries: [] },
    { ...valid, entries: "no" },
    { ...valid, entries: [{ kind: "other", name: "x" }] },
    { ...valid, entries: [{ kind: "step", name: "" }] },
    ...entries.map((_, i) => ({
      ...valid,
      entries: entries.filter((_, j) => i !== j),
    })),
    { ...valid, entries: [...entries].reverse() },
    {
      ...valid,
      entries: entries.map((entry, i) =>
        i === 1 ? { ...entry, kind: "step" } : entry,
      ),
    },
  ])
    assert.throws(() => validateLoop(bad));
});

test("check-loop reads YAML and reports errors", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-loop-"));
  try {
    const path = join(root, "loop.yaml");
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [cli, "definition", "check-loop", ...args], {
        encoding: "utf8",
      });
    assert.notEqual(run().status, 0);
    const missing = run(path);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /loop\.yaml/);
    writeFileSync(path, "name: [\n");
    assert.notEqual(run(path).status, 0);
    writeFileSync(
      path,
      "name: simple\nproduces_code: false\nentries:\n  - kind: step\n    name: inspect\n",
    );
    const result = run(path);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Loop valid: simple\n");
    writeFileSync(
      path,
      JSON.stringify({ ...valid, entries: entries.slice(1) }),
    );
    const invalid = run(path);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /coder/i);
    writeFileSync(path, JSON.stringify(valid));
    assert.equal(run(path).stdout, "Loop valid: build\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
