import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectSpendSpikes, spendSpikeInboxItem, type SpanRecord } from '../src/index.ts';

const NOW = new Date('2026-11-27T06:00:00Z');
const DAY = 86_400_000;
const dayAgo = (n: number) => new Date(Date.UTC(2026, 10, 27) - n * DAY + 12 * 3_600_000).toISOString();

/** `runs` model spans of `cost` each on the day `n` days ago. */
function day(n: number, runs: number, cost: number, step = 'coder', model = 'anthropic/opus'): SpanRecord[] {
  return Array.from({ length: runs }, (_, i) => ({
    trace_id: `t${n}-${i}`,
    span_id: `s${n}-${i}`,
    type: 'model',
    name: step,
    project: 'p',
    started_at: dayAgo(n),
    ended_at: dayAgo(n),
    outcome: 'completed',
    cost_usd: cost,
    step,
    model,
  })) as SpanRecord[];
}
const baseline = () => Array.from({ length: 10 }, (_, i) => day(i + 3, 4, 1)).flat();

test('one day at 2x the median is a spike with the top runs', () => {
  const latest = day(1, 4, 2);
  latest[0]!.cost_usd = 5;
  const [spike] = detectSpendSpikes([...baseline(), ...latest], NOW);
  assert.equal(spike?.rule, 'one-day');
  assert.equal(spike?.step, 'coder');
  assert.equal(spike?.top_runs[0]?.trace_id, 't1-0');
  assert.match(spendSpikeInboxItem(spike!).detail ?? '', /t1-0 \$5\.00/);
  assert.equal(spendSpikeInboxItem(spike!).kind, 'spend-spike');
});

test('1.5x on two days in a row is a spike; on one day it is not', () => {
  assert.equal(detectSpendSpikes([...baseline(), ...day(1, 4, 1.6)], NOW).length, 0);
  const two = detectSpendSpikes([...baseline(), ...day(1, 4, 1.6), ...day(2, 4, 1.6)], NOW);
  assert.equal(two[0]?.rule, 'two-days');
});

test('normal cost is no spike', () => {
  assert.deepEqual(detectSpendSpikes([...baseline(), ...day(1, 4, 1.1)], NOW), []);
});

test('a volume change is not a spike', () => {
  assert.deepEqual(detectSpendSpikes([...baseline(), ...day(1, 8, 3)], NOW), []);
});

test('too little history is no spike', () => {
  assert.deepEqual(detectSpendSpikes([...day(3, 4, 1), ...day(1, 4, 5)], NOW), []);
});
