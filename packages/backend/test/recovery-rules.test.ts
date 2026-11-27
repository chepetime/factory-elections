// Every stored run state and task stage has a recovery rule, and the rules agree with the code that
// acts on them. A new state fails here (and in the compiler) until someone names its recovery step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAGES, runWorking } from '@factory/core';
import { RunRecord } from '../src/run-record.ts';
import {
  RUN_RECOVERY,
  STAGE_RECOVERY,
  failsWhenInterrupted,
  type RecoveryRule,
} from '../src/recovery-rules.ts';

const tables: [string, Record<string, RecoveryRule>, readonly string[]][] = [
  ['run', RUN_RECOVERY, RunRecord.shape.state.options],
  ['stage', STAGE_RECOVERY, STAGES],
];

for (const [name, table, states] of tables) {
  test(`every ${name} state has exactly one recovery rule`, () => {
    assert.deepEqual(Object.keys(table).sort(), [...states].sort());
    for (const state of states) {
      const rule = table[state]!;
      assert.ok(['final', 'idle', 'person', 'reconciler'].includes(rule.kind), `${state}: ${rule.kind}`);
      assert.ok(rule.note.length > 0, `${state} says what happens`);
      assert.equal(rule.kind === 'reconciler', 'step' in rule, `${state}: only reconcilers name a step`);
    }
  });
}

test('only a queued and a running run are reconciled, and queued is queued again', () => {
  const reconciled = RunRecord.shape.state.options.filter((s) => RUN_RECOVERY[s].kind === 'reconciler');
  assert.deepEqual(reconciled, ['queued', 'running']);
  assert.equal(RUN_RECOVERY.queued.kind === 'reconciler' && RUN_RECOVERY.queued.step, 'requeue');
  assert.equal(RUN_RECOVERY.running.kind === 'reconciler' && RUN_RECOVERY.running.step, 'interrupt');
  assert.equal(RUN_RECOVERY.interrupted.kind, 'person');
});

test('a task fails with its interrupted run exactly when its stage says a run is working', () => {
  for (const stage of STAGES) assert.equal(failsWhenInterrupted(stage), runWorking(stage), stage);
});
