import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateStep } from "../packages/core/src/step.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const valid = {
  name: "review",
  prompt: "prompt.md",
  model: "ladder",
  inputs: [],
  outputs: ["result"],
};

test("step schema requires nonempty strings and lists of nonempty strings", () => {
  assert.equal(validateStep(valid).name, "review");
  for (const bad of [
    {},
    ...["name", "prompt", "model"].map((key) => ({ ...valid, [key]: "" })),
    { ...valid, inputs: [""] },
    { ...valid, outputs: [42] },
    { ...valid, inputs: "input" },
    { ...valid, outputs: null },
  ])
    assert.throws(() => validateStep(bad));
});

test("check-step validates YAML and resolves a prompt file relative to its definition", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-step-"));
  try {
    const dir = join(root, "definitions");
    mkdirSync(dir);
    const path = join(dir, "step.yaml");
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [cli, "definition", "check-step", ...args], {
        encoding: "utf8",
        cwd: root,
      });
    assert.notEqual(run().status, 0);
    assert.match(run(path).stderr, /step\.yaml/);
    writeFileSync(path, "name: [\n");
    assert.notEqual(run(path).status, 0);
    writeFileSync(path, JSON.stringify({ ...valid, model: "" }));
    assert.match(run(path).stderr, /model/);
    writeFileSync(path, JSON.stringify(valid));
    assert.match(run(path).stderr, /prompt\.md/);
    mkdirSync(join(dir, "prompt.md"));
    assert.match(run(path).stderr, /Prompt is not a file/);
    rmSync(join(dir, "prompt.md"), { recursive: true });
    writeFileSync(join(dir, "prompt.md"), "prompt");
    const result = run(path);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Step valid: review\n");
    writeFileSync(
      path,
      JSON.stringify({ ...valid, prompt: join(dir, "prompt.md") }),
    );
    assert.match(run(path).stderr, /relative/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
