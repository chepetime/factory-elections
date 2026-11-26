import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DataStorage } from '@factory/adapters-data';
import { ExperimentStore } from '../src/experiments.ts';

test('records and reloads concurrent experiments per project', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-experiments-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new DataStorage(root);
  const store = new ExperimentStore(root, storage);
  await Promise.all([
    store.add('demo', { date: '2026-11-18', change: 'Route QA to Sonnet', task_classes: ['feature'] }),
    store.add('demo', { date: '2026-11-19', change: 'Reuse cache', task_classes: ['bug', 'feature'] }),
  ]);
  assert.equal((await new ExperimentStore(root, storage).list('demo')).length, 2);
  assert.deepEqual(await store.list('other'), []);
  await assert.rejects(store.add('demo', { date: 'invalid', change: 'x', task_classes: [] }));
});
