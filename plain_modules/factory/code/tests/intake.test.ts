import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTask } from "../packages/core/src/task.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("intake writes a queued task and prints a fresh UUID", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-"));
  try {
    const run = () =>
      spawnSync(
        process.execPath,
        [
          cli,
          "intake",
          "--project",
          "Project_1-x",
          "--repo",
          root,
          "  hello\nworld  ",
        ],
        { encoding: "utf8", env: { ...process.env, FACTORY_ROOT: root } },
      );
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(
      first.stdout,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\n$/,
    );
    const id = first.stdout.trim();
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          join(root, "Project_1-x", "tasks", id, "task.json"),
          "utf8",
        ),
      ),
      {
        id,
        project: "Project_1-x",
        repo: root,
        prompt: "  hello\nworld  ",
        stage: "queued",
      },
    );
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.notEqual(second.stdout, first.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid intake creates no task", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-"));
  try {
    const file = join(root, "file");
    writeFileSync(file, "x");
    for (const [project, repo, prompt] of [
      ["../bad", root, "ok"],
      ["", root, "ok"],
      ["é", root, "ok"],
      ["good", "relative", "ok"],
      ["good", file, "ok"],
      ["good", join(root, "missing"), "ok"],
      ["good", root, " \n "],
    ]) {
      const result = spawnSync(
        process.execPath,
        [cli, "intake", "--project", project, "--repo", repo, prompt],
        { encoding: "utf8", env: { ...process.env, FACTORY_ROOT: root } },
      );
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
    }
    assert.equal(existsSync(join(root, "good")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("task domain validates input and preserves its fields", () => {
  assert.deepEqual(createTask("id", "p", "/repo", " x "), {
    id: "id",
    project: "p",
    repo: "/repo",
    prompt: " x ",
    stage: "queued",
  });
  assert.throws(() => createTask("id", "bad/name", "/repo", "x"));
  assert.throws(() => createTask("id", "p", "/repo", " "));
});
