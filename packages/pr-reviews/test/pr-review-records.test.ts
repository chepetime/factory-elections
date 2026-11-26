import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DataStorage } from '@factory/adapters-data';
import { PrReviewStore } from '../src/pr-review-records.ts';

test('review records persist for human and agent reviewers per project', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-pr-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new DataStorage(root);
  const store = new PrReviewStore(root, storage);
  const common = {
    pr_number: 42,
    verdict: 'changes requested',
    findings: [{ text: 'Missing check', path: 'src/a.ts', line: 2 }],
    reviewed_at: '2026-11-18T12:00:00.000Z',
    duration_ms: 5000,
  };
  await Promise.all([
    store.add('demo', { ...common, reviewer: { kind: 'human', identity: 'ada' } }),
    store.add('demo', { ...common, reviewer: { kind: 'agent', identity: 'review-run-1' } }),
  ]);
  assert.equal((await new PrReviewStore(root, storage).list('demo')).length, 2);
  assert.deepEqual(await store.list('other'), []);
  await assert.rejects(store.add('demo', { ...common, reviewer: { kind: 'agent', identity: '' } }));
});
