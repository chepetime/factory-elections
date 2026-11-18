import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DataStorage } from '@factory/adapters-data';
import { outcomeTraceIds, type SpanRecord } from '@factory/core';
import { OutcomeStore } from '../src/outcomes.ts';

test('outcomes persist per project and link only matching task or PR spans', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-outcomes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new DataStorage(root);
  const store = new OutcomeStore(root, storage);
  const task_id = '11111111-1111-4111-8111-111111111111';
  const pr = { url: 'https://github.com/a/b/pull/1', number: 1 };
  const record = await store.add('app', { kind: 'merged', occurred_at: '2026-11-18T00:00:00Z', task_id, pr });
  await store.add('app', { kind: 'reverted', occurred_at: '2026-11-19T00:00:00Z', pr });
  await store.add('app', { kind: 'incident', occurred_at: '2026-11-20T00:00:00Z', task_id });
  assert.equal((await new OutcomeStore(root, storage).list('app')).length, 3);
  assert.deepEqual(await store.list('other'), []);
  await assert.rejects(store.add('app', { kind: 'merged', occurred_at: '2026-11-18T00:00:00Z' }));
  const span = (fields: Partial<SpanRecord>): SpanRecord => ({
    trace_id: 'x',
    span_id: 's',
    type: 'run',
    name: 'run',
    project: 'app',
    started_at: '2026-11-18',
    ended_at: '2026-11-18',
    outcome: 'completed',
    ...fields,
  });
  assert.deepEqual(
    outcomeTraceIds(record, 'app', [
      span({ trace_id: 'task', task_id }),
      span({ trace_id: 'pr', pr }),
      span({ trace_id: 'wrong-project', task_id, project: 'other' }),
      span({ trace_id: 'conflict', task_id, pr: { url: 'https://github.com/a/b/pull/2' } }),
    ]),
    ['pr', 'task'],
  );
});
