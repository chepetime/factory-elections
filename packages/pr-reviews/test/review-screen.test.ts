// The cheap screen before the senior review: depth rules, fail-safe fallbacks, and a labeled set
// that checks the screen never sends a PR with a must-fix finding to the cheaper review.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import type { ModelResult, ModelRun, ModelRunner } from '@factory/core';
import {
  RISK_THRESHOLD,
  ScreenOutput,
  chooseDepth,
  diffStats,
  planAttributes,
  planRecord,
  planReview,
} from '../src/review-screen.ts';

const sure = (files: [string, number][]): ScreenOutput => ({
  sure: true,
  files: files.map(([file, score]) => ({ file, score, reason: 'r' })),
});
const stats = (files: string[], changed = 20) => ({ files, changed });

const diffOf = (file: string, lines = 3) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${'+x\n'.repeat(lines)}-y\n`;
const runner = (
  answer: () => Partial<ModelResult> | Promise<Partial<ModelResult>>,
  seen: ModelRun[] = [],
): ModelRunner => ({
  run: async (request) => {
    seen.push(request);
    return { text: '', costUsd: 0.01, ...(await answer()) };
  },
});

test('diffStats reads files and counts changed lines without the file headers', () => {
  assert.deepEqual(diffStats(diffOf('src/a.ts', 3)), { files: ['src/a.ts'], changed: 4 });
});

test('a low-risk small diff gets the Sonnet review', () => {
  assert.equal(chooseDepth(stats(['src/a.ts']), sure([['src/a.ts', 0.1]])).depth, 'sonnet');
});

test('risk at the threshold, an unsure screen or a missing file raise the depth to Opus', () => {
  assert.equal(chooseDepth(stats(['a.ts']), sure([['a.ts', RISK_THRESHOLD]])).depth, 'opus');
  assert.equal(chooseDepth(stats(['a.ts']), { sure: false, files: [] }).depth, 'opus');
  assert.equal(chooseDepth(stats(['a.ts', 'b.ts']), sure([['a.ts', 0]])).depth, 'opus');
  assert.equal(chooseDepth(stats(['a.ts']), undefined).depth, 'opus');
  assert.equal(chooseDepth(stats([]), sure([])).depth, 'opus');
});

test('a large diff and security-sensitive paths raise the depth, whatever the screen scored', () => {
  assert.equal(chooseDepth(stats(['a.ts'], 401), sure([['a.ts', 0]])).depth, 'opus');
  const many = Array.from({ length: 13 }, (_, i) => `f${i}.ts`);
  assert.equal(chooseDepth(stats(many), sure(many.map((f) => [f, 0]))).depth, 'opus');
  for (const path of [
    'src/auth/login.ts',
    'lib/session-store.ts',
    '.github/workflows/ci.yml',
    'pnpm-lock.yaml',
    'db/migrations/001.sql',
    'Dockerfile',
  ])
    assert.equal(chooseDepth(stats([path]), sure([[path, 0]])).depth, 'opus', path);
});

test('a path rule cannot lower the depth: a high score on a plain path stays Opus', () => {
  assert.equal(chooseDepth(stats(['docs/guide.md']), sure([['docs/guide.md', 0.9]])).depth, 'opus');
});

test('the screen runs on Haiku with a small budget, and its cost and the depth land in the plan', async () => {
  const seen: ModelRun[] = [];
  const plan = await planReview(
    runner(() => ({ structured: sure([['src/a.ts', 0.05]]), costUsd: 0.004 }), seen),
    diffOf('src/a.ts'),
  );
  assert.equal(seen[0]!.model, 'claude-haiku-5-5');
  assert.equal(seen[0]!.tools, 'none');
  assert.ok(seen[0]!.maxBudgetUsd! <= 0.05);
  assert.deepEqual(
    [plan.depth, plan.model, plan.screenCostUsd, plan.screened],
    ['sonnet', 'claude-sonnet-5-5', 0.004, true],
  );
  assert.ok(plan.budgetUsd! < 25);
  const attributes = planAttributes(planRecord(plan));
  assert.deepEqual(
    [attributes.review_depth, attributes.screen_cost_usd, attributes.screen_max_score],
    ['sonnet', 0.004, 0.05],
  );
});

test('a failed, malformed or missing screen falls back to the full Opus review', async () => {
  const failed = await planReview(
    runner(() => {
      throw new Error('rate limited\nmore');
    }),
    diffOf('a.ts'),
  );
  assert.deepEqual(
    [failed.depth, failed.screened, failed.reason],
    ['opus', false, 'screen failed: rate limited'],
  );
  assert.equal(
    (
      await planReview(
        runner(() => ({ structured: { files: 'no' } })),
        diffOf('a.ts'),
      )
    ).depth,
    'opus',
  );
  assert.equal(
    (
      await planReview(
        runner(() => ({})),
        diffOf('a.ts'),
      )
    ).depth,
    'opus',
  );
  assert.equal((await planReview(undefined, diffOf('a.ts'))).depth, 'opus');
  assert.equal(
    (
      await planReview(
        runner(() => ({ structured: sure([]) })),
        undefined,
      )
    ).depth,
    'opus',
  );
  assert.equal(planAttributes(undefined).review_depth, undefined);
});

interface Case {
  name: string;
  files: string[];
  changed: number;
  screen: ScreenOutput;
  opus_findings: { file: string; severity: string }[];
}

test('labeled set: no past PR with a must-fix Opus finding is planned for the Sonnet review', async () => {
  const { cases } = JSON.parse(
    await readFile(new URL('./fixtures/screen-eval.json', import.meta.url), 'utf8'),
  ) as { cases: Case[] };
  const depths = cases.map((c) => ({
    c,
    depth: chooseDepth({ files: c.files, changed: c.changed }, ScreenOutput.parse(c.screen)).depth,
  }));
  for (const { c, depth } of depths)
    if (c.opus_findings.some((f) => f.severity === 'must-fix'))
      assert.equal(depth, 'opus', `${c.name}: dropped a must-fix finding`);
  assert.ok(
    depths.some(({ depth }) => depth === 'sonnet'),
    'the set also has cases the screen saves money on',
  );
});
