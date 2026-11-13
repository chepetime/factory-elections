import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const ids = [
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174000",
];

test("list returns sorted validated records atomically without modifying files", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-list-"));
  const run = (args = ["--project", "p"]) =>
    spawnSync(process.execPath, [cli, "task", "list", ...args], {
      encoding: "utf8",
      env: { ...process.env, FACTORY_ROOT: root },
    });
  try {
    assert.equal(run().stdout, "[]\n");
    const records = ids.map((id) => ({
      id,
      project: "p",
      repo: "/repo",
      prompt: "hello",
      stage: "queued",
      extra: 1,
    }));
    for (const record of records) {
      const dir = join(root, "p", "tasks", record.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "task.json"), JSON.stringify(record));
    }
    writeFileSync(join(root, "p", "tasks", "ignored"), "not a directory");
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, JSON.stringify([...records].reverse()) + "\n");
    const file = join(root, "p", "tasks", ids[0]!, "task.json");
    for (const invalid of [
      "{",
      JSON.stringify({ ...records[0], project: "other" }),
      JSON.stringify({ ...records[0], id: ids[1] }),
      JSON.stringify({ ...records[0], stage: "done" }),
    ]) {
      writeFileSync(file, invalid);
      const failure = run();
      assert.notEqual(failure.status, 0);
      assert.equal(failure.stdout, "");
      assert.notEqual(failure.stderr, "");
      assert.equal(readFileSync(file, "utf8"), invalid);
    }
    rmSync(file);
    assert.notEqual(run().status, 0);
    for (const args of [
      ["--project", "../p"],
      [],
      ["--project", "p", "extra"],
    ]) {
      const failure = run(args);
      assert.notEqual(failure.status, 0);
      assert.equal(failure.stdout, "");
      assert.notEqual(failure.stderr, "");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
