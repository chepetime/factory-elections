import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const id = "123e4567-e89b-42d3-a456-426614174000";

test("show reads and validates the task record without changing it", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-show-"));
  const dir = join(root, "p", "tasks", id);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "task.json");
  const record = {
    id,
    project: "p",
    repo: "/repo",
    prompt: "hi",
    stage: "queued",
    extra: { x: 1 },
  };
  const run = (args: string[]) =>
    spawnSync(process.execPath, [cli, "task", "show", ...args], {
      encoding: "utf8",
      env: { ...process.env, FACTORY_ROOT: root },
    });
  const args = ["--project", "p", "--id", id];
  try {
    const original = JSON.stringify(record, null, 2);
    writeFileSync(file, original);
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, JSON.stringify(record) + "\n");
    assert.equal(readFileSync(file, "utf8"), original);
    for (const invalid of [
      "{",
      JSON.stringify({ ...record, id: "123e4567-e89b-42d3-a456-426614174001" }),
      JSON.stringify({ ...record, project: "other" }),
      JSON.stringify({ ...record, stage: "done" }),
      JSON.stringify({ ...record, repo: "" }),
      JSON.stringify({ ...record, prompt: "" }),
      JSON.stringify({ ...record, id: "bad" }),
      JSON.stringify({ ...record, project: "bad/name" }),
      JSON.stringify({ ...record, prompt: 1 }),
      "null",
    ]) {
      writeFileSync(file, invalid);
      const failure = run(args);
      assert.notEqual(failure.status, 0, invalid);
      assert.equal(failure.stdout, "");
      assert.notEqual(failure.stderr, "");
      assert.equal(readFileSync(file, "utf8"), invalid);
    }
    for (const invalidArgs of [
      [],
      ["--project", "../p", "--id", id],
      ["--project", "p", "--id", "../bad"],
      ["--project", "p", "--project", "p"],
      ["--help"],
      ["--project", "p", "--id", "123e4567-e89b-42d3-a456-426614174001"],
    ]) {
      const failure = run(invalidArgs);
      assert.notEqual(failure.status, 0);
      assert.equal(failure.stdout, "");
      assert.notEqual(failure.stderr, "");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
