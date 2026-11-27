import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  measureFix,
  pickDailyFinding,
  wasteFindings,
  wasteJobMayRun,
  type WasteTask,
} from '../src/waste-mining.ts';
import type { SpanRecord } from '../src/trace.ts';

const now = new Date('2026-11-27T12:00:00.000Z');
const task = (id: string, over: Partial<WasteTask> = {}): WasteTask => ({
  task_id: id,
  project: 'app',
  tend_fixes: 0,
  tending_stopped: false,
  review_fixes: 0,
  cost_usd: 2,
  ...over,
});
const none: SpanRecord[] = [];

test('findings are ranked by wasted dollars and need evidence', () => {
  const tasks = [
    task('a', { tending_stopped: true, cost_usd: 5 }),
    task('b', { review_fixes: 2, cost_usd: 3 }),
    task('c'),
  ];
  const f = wasteFindings(none, tasks, now);
  assert.deepEqual(
    f.map((x) => x.kind),
    ['stopped-tending', 'review-limit'],
  );
  assert.deepEqual(f[0]!.evidence, ['a']);
  assert.equal(f[0]!.wasted_usd, 5);
});

test('at most one ticket a day', () => {
  const f = wasteFindings(none, [task('a', { tending_stopped: true })], now);
  assert.equal(pickDailyFinding(f, true), undefined);
  assert.equal(pickDailyFinding(f, false)?.kind, 'stopped-tending');
  assert.equal(pickDailyFinding([], false), undefined);
});

test('tasks with unknown cost are not counted', () => {
  assert.deepEqual(wasteFindings(none, [task('a', { tending_stopped: true, cost_usd: null })], now), []);
});

test('measureFix reports unchanged when nothing is wasted before or after', () => {
  const o = measureFix(none, [], 'stopped-tending', now);
  assert.deepEqual(o, { before: 0, after: 0, verdict: 'unchanged' });
});

test('the job refuses to run past its own cap', () => {
  assert.equal(wasteJobMayRun(0.1), true);
  assert.equal(wasteJobMayRun(0.5), false);
});
