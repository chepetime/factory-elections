import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const valid = {
  intake_id: "intake",
  kind: "code",
  loe: "S",
  readiness: "ready",
  blockers: [],
};

test("verdict check validates schema and blocker priority", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-verdict-"));
  const path = join(root, "verdict.json");
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, "verdict", "check", ...args], {
      encoding: "utf8",
    });
  const check = (value: unknown, ok: boolean) => {
    writeFileSync(path, JSON.stringify(value));
    const result = run(path);
    if (ok) {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "Verdict valid: intake\n");
    } else {
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.notEqual(result.stderr, "");
    }
  };
  try {
    for (const result of [run(), run(path)]) {
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.notEqual(result.stderr, "");
    }
    writeFileSync(path, "{");
    assert.notEqual(run(path).status, 0);
    check(valid, true);
    for (const kind of ["research", "clarification", "slicing"]) {
      check(
        {
          ...valid,
          kind: "unsupported",
          loe: "unknown",
          readiness: `needs-${kind}`,
          blockers: [{ kind, question: "Why?", extra: true }],
          extra: 1,
        },
        true,
      );
    }
    check(
      {
        ...valid,
        readiness: "needs-research",
        blockers: [
          { kind: "slicing", question: "Slice?" },
          { kind: "research", question: "Research?" },
        ],
      },
      true,
    );
    for (const bad of [
      {},
      { ...valid, intake_id: "" },
      { ...valid, kind: "other" },
      { ...valid, loe: "XL" },
      { ...valid, readiness: "needs-research" },
      { ...valid, blockers: [{ kind: "research", question: "Why?" }] },
      {
        ...valid,
        readiness: "needs-slicing",
        blockers: [
          { kind: "slicing", question: "Slice?" },
          { kind: "clarification", question: "Clarify?" },
        ],
      },
      { ...valid, blockers: [{ kind: "other", question: "Why?" }] },
      { ...valid, blockers: [{ kind: "research", question: "" }] },
    ])
      check(bad, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
