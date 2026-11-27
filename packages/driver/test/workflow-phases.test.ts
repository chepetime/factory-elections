// Phase timing: the driver reports worktree, setup (hit or miss) and verify spans, and nothing else changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Driver } from '../src/index.ts';
import type { PhaseSpan } from '../src/ports.ts';
import { ready, setup, withProfile, writeFeature, approveReview } from './workflow-fixture.ts';

test('worktree, setup miss, setup hit and verify each emit one span', async () => {
  const ctx = await setup({ classifier: [ready], coder: [writeFeature], reviewer: [approveReview] });
  const spans: PhaseSpan[] = [];
  ctx.driver.deps.phase = (_task, span) => void spans.push(span);
  withProfile(ctx.driver, (p) => ({ ...p, commands: { ...p.commands, setup: 'true' } }));
  await ctx.driver.classify('demo', ctx.task.id);
  await ctx.driver.prepareWorktree('demo', ctx.task.id);
  const kinds = spans.map((s) => `${s.type}:${s.attributes?.setup_key ?? ''}`);
  assert.deepEqual(kinds, ['worktree:', 'setup:miss']);
  await ctx.driver.setupWorktree('demo', ctx.task.id);
  assert.equal(spans.at(-1)!.type, 'setup');
  assert.equal(spans.at(-1)!.attributes?.setup_key, 'hit');
  const path = (await ctx.store.read('demo', ctx.task.id)).worktree!.path;
  await writeFile(join(path, 'feature.txt'), 'done\n');
  await ctx.driver.verifyAndRecord('demo', ctx.task.id);
  const verify = spans.filter((s) => s.type === 'verify');
  assert.equal(verify.length, 1);
  assert.ok(['completed', 'failed'].includes(verify[0]!.outcome));
  for (const s of spans) {
    assert.ok(s.duration_ms >= 0);
    assert.ok(s.started_at <= s.ended_at);
  }
});

test('a failing phase sink does not break the run', async () => {
  const ctx = await setup({ classifier: [ready], coder: [writeFeature], reviewer: [approveReview] });
  ctx.driver.deps.phase = () => {
    throw new Error('sink down');
  };
  await ctx.driver.classify('demo', ctx.task.id);
  const task = await ctx.driver.prepareWorktree('demo', ctx.task.id);
  assert.ok(task.worktree);
  assert.ok(ctx.driver instanceof Driver);
});
