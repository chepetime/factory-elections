import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recoveryBlocker, recoveryInboxItems, type RecoveryReport } from '../src/index.ts';

const report: RecoveryReport = {
  state: 'degraded',
  problems: [
    { project: 'app', task_id: 't1', error: 'bad JSON', since: '2026-11-26T10:00:00.000Z' },
    { project: 'web', error: 'EACCES', since: '2026-11-26T10:00:00.000Z' },
  ],
};

test('a task recovery could not read, or any task of a project it could not list, is refused', () => {
  assert.match(recoveryBlocker(report, 'app', 't1')!, /this task's last run \(bad JSON\)/);
  assert.equal(recoveryBlocker(report, 'app', 't2'), undefined, 'other tasks of the project are known');
  assert.match(recoveryBlocker(report, 'web', 'any')!, /this project \(EACCES\)/);
  assert.equal(recoveryBlocker({ state: 'ok', problems: [] }, 'app', 't1'), undefined);
});

test('each recovery problem is one inbox item with a stable id', () => {
  const items = recoveryInboxItems(report);
  assert.deepEqual(
    items.map((i) => [i.kind, i.id, i.task_id]),
    [
      ['recovery', 'recovery:app:t1:2026-11-26T10:00:00.000Z', 't1'],
      ['recovery', 'recovery:web:2026-11-26T10:00:00.000Z', undefined],
    ],
  );
});
