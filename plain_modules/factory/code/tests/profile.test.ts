import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateProfile } from "../packages/core/src/profile.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const valid = {
  project: "demo_1",
  approved_at: "2026-01-01",
  repo: { base_branch: { value: "main", source: "user" } },
  commands: { test: "npm test", full_check: "npm run check" },
  confirmed: { forbidden_paths: [], forbidden_commands: ["rm"] },
  design_sources: [],
  qa_targets: ["unit"],
};

test("profile schema validates all required fields and project identity", () => {
  validateProfile(valid, "demo_1");
  for (const bad of [
    { ...valid, project: "other" },
    { ...valid, approved_at: "" },
    { ...valid, repo: { base_branch: { value: "", source: "x" } } },
    { ...valid, repo: { base_branch: { value: "main", source: "" } } },
    { ...valid, commands: { test: "", full_check: "x" } },
    { ...valid, commands: { test: "x", full_check: "" } },
    { ...valid, confirmed: { forbidden_paths: [1], forbidden_commands: [] } },
    { ...valid, confirmed: { forbidden_paths: [], forbidden_commands: "rm" } },
    { ...valid, design_sources: null },
    { ...valid, qa_targets: [false] },
    {},
  ])
    assert.throws(() => validateProfile(bad, "demo_1"));
});

test("profile check reads YAML, reports errors and never changes tasks", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-profile-"));
  try {
    const dir = join(root, "demo_1");
    mkdirSync(join(dir, "tasks", "id"), { recursive: true });
    const task = join(dir, "tasks", "id", "task.json");
    writeFileSync(task, "original");
    const run = (project = "demo_1") =>
      spawnSync(
        process.execPath,
        [cli, "profile", "check", "--project", project],
        { encoding: "utf8", env: { ...process.env, FACTORY_ROOT: root } },
      );
    const missing = run();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /profile\.yaml/);
    const path = join(dir, "profile.yaml");
    writeFileSync(path, "project: [\n");
    assert.notEqual(run().status, 0);
    writeFileSync(path, JSON.stringify({ ...valid, approved_at: "" }));
    assert.match(run().stderr, /approved_at/);
    writeFileSync(
      path,
      `project: demo_1\napproved_at: '2026-01-01'\nrepo:\n  base_branch:\n    value: main\n    source: user\ncommands:\n  test: npm test\n  full_check: npm run check\nconfirmed:\n  forbidden_paths: []\n  forbidden_commands: [rm]\ndesign_sources: []\nqa_targets: [unit]\n`,
    );
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Profile valid: demo_1\n");
    assert.notEqual(run("../demo_1").status, 0);
    assert.equal(readFileSync(task, "utf8"), "original");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
