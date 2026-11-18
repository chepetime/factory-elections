import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricsSummary, traceTree } from '../src/metrics.ts';
import type { SpanRecord } from '../src/trace.ts';

let n = 0;
const span = (x: Partial<SpanRecord> & Pick<SpanRecord, 'type'>): SpanRecord => ({
  trace_id: 't1',
  span_id: `s${++n}`,
  name: x.type,
  project: 'app',
  started_at: `2026-11-16T10:00:${String(n).padStart(2, '0')}.000Z`,
  ended_at: `2026-11-16T10:01:${String(n).padStart(2, '0')}.000Z`,
  outcome: 'completed',
  ...x,
});

test('a trace tree rolls up its spans and keeps unknown costs apart', () => {
  const run = span({ type: 'run', span_id: 'run' });
  const coder = span({
    type: 'model',
    span_id: 'coder',
    parent_span_id: 'run',
    cost_usd: 1,
    tokens: { input: 100, output: 10, cache_read: 50, cache_write: 7 },
  });
  const child = span({ type: 'child', parent_span_id: 'coder', cost_usd: null });
  const tool = span({ type: 'tool', parent_span_id: 'coder' });
  const [root] = traceTree([tool, child, coder, run]);
  assert.equal(root!.span.span_id, 'run');
  assert.equal(root!.children[0]!.children.length, 2);
  assert.deepEqual(root!.total, {
    cost_usd: 1,
    unknown_cost_spans: 1,
    tokens: { input: 100, output: 10, cache_read: 50, cache_write: 7 },
  });
});

test('metrics count runs, first passes, climbs, call grading, PRs, gates and reliability', () => {
  const spans: SpanRecord[] = [];
  // Three code/S runs: two pass first time on sonnet, one climbs to opus.
  for (const [i, models] of [
    ['claude-sonnet-5-5'],
    ['claude-sonnet-5-5'],
    ['claude-sonnet-5-5', 'claude-opus-5-5'],
  ].entries()) {
    const trace_id = `run${i}`;
    spans.push(
      span({
        type: 'run',
        trace_id,
        span_id: `r${i}`,
        task_id: `task${i}`,
        task_class: 'code/S',
        duration_ms: 1000 * (i + 1),
        attributes: { stage: 'awaiting-approval' },
      }),
      ...models.map((model) =>
        span({
          type: 'model',
          trace_id,
          task_id: `task${i}`,
          parent_span_id: `r${i}`,
          step: 'coder',
          model,
          provider: 'claude',
          cost_usd: 0.5,
        }),
      ),
    );
  }
  spans.push(
    span({
      type: 'run',
      trace_id: 'bad',
      task_id: 'task9',
      outcome: 'failed',
      attributes: { stage: 'failed' },
    }),
    span({
      type: 'model',
      trace_id: 'bad',
      task_id: 'task9',
      step: 'coder',
      model: 'codex',
      provider: 'codex',
      cost_usd: null,
      outcome: 'failed',
      error: 'stalled: no message for 600s',
    }),
    span({ type: 'loop-judge', trace_id: 'bad', cost_usd: 0.01, attributes: { stuck: true } }),
    span({ type: 'tool', trace_id: 'bad', outcome: 'failed' }),
    span({ type: 'gate', trace_id: 'g', task_id: 'task0', duration_ms: 60_000 }),
    span({
      type: 'pr',
      trace_id: 'p',
      task_id: 'task0',
      pr: { url: 'https://github.com/o/r/pull/1', number: 1 },
    }),
    span({ type: 'review', trace_id: 'rv', cost_usd: 2, ended_at: '2026-11-17T09:00:00.000Z' }),
    span({ type: 'model', trace_id: 'old', cost_usd: 99, ended_at: '2026-11-01T00:00:00.000Z' }),
  );
  const m = metricsSummary(spans, '2026-11-10T00:00:00.000Z', '2026-11-18T00:00:00.000Z');
  assert.equal(Number(m.total.cost_usd.toFixed(2)), 4.01, 'the span outside the range is left out');
  assert.equal(m.total.unknown_cost_spans, 1);
  assert.deepEqual(
    m.days.map((d) => d.day),
    ['2026-11-16', '2026-11-17'],
  );
  assert.equal(m.days[0]!.by_provider.claude, 2);
  assert.deepEqual(
    [m.runs.count, m.runs.failed, m.runs.first_pass_rate, m.runs.climb_rate, m.runs.median_duration_ms],
    [4, 1, 0.5, 0.25, 2000],
  );
  assert.deepEqual(
    m.call_grading.map((g) => [g.task_class, g.first_model, g.runs, g.first_pass, g.climbed, g.grade]),
    [
      ['code/S', 'claude-sonnet-5-5', 3, 2, 1, 'too-weak'],
      ['unclassified', 'codex', 1, 0, 0, 'too-few'],
    ],
  );
  assert.deepEqual(m.reliability, { stalls: 1, repeat_loops: 1, failed_tool_calls: 1, tool_calls: 1 });
  assert.deepEqual([m.prs.count, m.prs.cost_usd, m.prs.median_run_ms], [1, 0.5, 1000]);
  assert.deepEqual([m.gates.count, m.gates.median_wait_ms], [1, 60_000]);
  assert.deepEqual([m.reviews.turns, m.reviews.cost_usd], [1, 2]);
  assert.equal(m.by_type.model!.spans, 5);
});

test('cache hit rate by step is token-weighted and respects the time range', () => {
  const spans = [
    span({ type: 'model', step: 'coder', tokens: { input: 100, output: 0, cache_read: 80 } }),
    span({ type: 'model', step: 'coder', tokens: { input: 300, output: 0, cache_read: 20 } }),
    span({ type: 'model', step: 'reviewer', tokens: { input: 200, output: 0, cache_read: 100 } }),
    span({ type: 'model', step: 'empty' }),
    span({
      type: 'model',
      step: 'coder',
      ended_at: '2026-10-01T00:00:00.000Z',
      tokens: { input: 100, output: 0, cache_read: 100 },
    }),
  ];
  const metrics = metricsSummary(spans, '2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z');
  assert.equal(metrics.by_step.coder!.cache_hit_rate, 0.25);
  assert.equal(metrics.by_step.reviewer!.cache_hit_rate, 0.5);
  assert.equal(metrics.by_step.empty!.cache_hit_rate, undefined);
});

test('unusual costs compare against at least 20 earlier complete runs of the same project and class', () => {
  const runs: SpanRecord[] = [];
  for (let i = 0; i < 22; i++) {
    const day = String(i + 1).padStart(2, '0');
    const trace_id = `cost-${i}`;
    runs.push(
      span({
        type: 'run',
        trace_id,
        task_class: 'code/S',
        started_at: `2026-10-${day}T10:00:00.000Z`,
        ended_at: `2026-10-${day}T11:00:00.000Z`,
      }),
      span({
        type: 'model',
        trace_id,
        cost_usd: i === 20 ? 10 : i === 21 ? null : 1,
        ended_at: `2026-10-${day}T10:30:00.000Z`,
      }),
    );
  }
  const m = metricsSummary(runs, '2026-10-21T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
  assert.deepEqual(
    m.runs.unusual.map(({ trace_id, cost_usd, threshold_usd, baseline_runs }) => ({
      trace_id,
      cost_usd,
      threshold_usd,
      baseline_runs,
    })),
    [{ trace_id: 'cost-20', cost_usd: 10, threshold_usd: 1, baseline_runs: 20 }],
  );
  assert.deepEqual(
    metricsSummary(runs.slice(0, 40), '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z').runs.unusual,
    [],
  );
});

test('unusual cost baseline expires after 90 days', () => {
  const runs: SpanRecord[] = [];
  for (let i = 0; i < 20; i++) {
    const trace_id = `old-${i}`;
    runs.push(
      span({
        type: 'run',
        trace_id,
        task_class: 'code/S',
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T01:00:00.000Z',
      }),
      span({ type: 'model', trace_id, cost_usd: 1, ended_at: '2026-01-01T00:30:00.000Z' }),
    );
  }
  runs.push(
    span({
      type: 'run',
      trace_id: 'later',
      task_class: 'code/S',
      started_at: '2026-05-01T00:00:00.000Z',
      ended_at: '2026-05-01T01:00:00.000Z',
    }),
    span({ type: 'model', trace_id: 'later', cost_usd: 10, ended_at: '2026-05-01T00:30:00.000Z' }),
  );
  assert.deepEqual(
    metricsSummary(runs, '2026-04-30T00:00:00.000Z', '2026-05-02T00:00:00.000Z').runs.unusual,
    [],
  );
});
