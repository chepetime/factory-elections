import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spendStatus } from '../src/spend-caps.ts';
import type { SpanRecord } from '../src/trace.ts';

const now = new Date('2026-11-27T12:00:00.000Z');
let n = 0;
const model = (endedAt: string, cost: number | null): SpanRecord => ({
  trace_id: 't',
  span_id: `s${++n}`,
  name: 'model',
  type: 'model',
  project: 'app',
  started_at: endedAt,
  ended_at: endedAt,
  outcome: 'completed',
  cost_usd: cost,
});

test('rolling window drops spend older than 24 hours but keeps it in the month', () => {
  const spans = [
    model('2026-11-27T11:00:00.000Z', 4),
    model('2026-11-26T11:00:00.000Z', 6), // 25h ago
  ];
  const s = spendStatus(spans, { daily_usd: 5, monthly_usd: 100 }, now);
  assert.equal(s.daily.spent_usd, 4);
  assert.equal(s.monthly.spent_usd, 10);
  assert.equal(s.daily.level, 'warn');
  assert.equal(s.level, 'warn');
  assert.equal(s.refusal, undefined);
});

test('reaching a cap refuses with a reason, and it lifts once the window rolls', () => {
  const spans = [model('2026-11-27T11:00:00.000Z', 5)];
  const capped = spendStatus(spans, { daily_usd: 5 }, now);
  assert.equal(capped.level, 'capped');
  assert.match(capped.refusal!, /Spend cap reached: \$5\.00 of \$5\.00 in the last 24 hours/);
  const later = new Date('2026-11-28T12:00:01.000Z');
  assert.equal(spendStatus(spans, { daily_usd: 5 }, later).level, 'ok');
  assert.equal(spendStatus(spans, { daily_usd: 6 }, now).level, 'warn');
});

test('unknown-cost spans add nothing but are counted; no caps means ok', () => {
  const spans = [model('2026-11-27T11:00:00.000Z', null), model('2026-11-27T11:30:00.000Z', 1)];
  const s = spendStatus(spans, { monthly_usd: 100 }, now);
  assert.equal(s.monthly.spent_usd, 1);
  assert.equal(s.monthly.unknown_cost_spans, 1);
  assert.equal(spendStatus(spans, {}, now).level, 'ok');
});
