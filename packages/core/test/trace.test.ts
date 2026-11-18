import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpanRecord, ToolSpans, newSpanId, newTraceId, taskClass, toolSummary } from '../src/trace.ts';

test('tool spans pair each result with the oldest open call of the same agent', () => {
  let now = 1000;
  const tools = new ToolSpans(() => now);
  tools.event({ type: 'tool', name: 'Bash', input: { command: 'pnpm test' } });
  now = 1100;
  tools.event({ type: 'tool', name: 'Read', input: { file_path: '/a.ts' }, sub: true });
  now = 1300;
  tools.event({ type: 'tool-result', ok: false, text: 'exit 1' });
  now = 1400;
  tools.event({ type: 'tool', name: 'Edit', input: { file_path: '/b.ts', new_string: 'secret body' } });
  const spans = tools.finish();
  assert.deepEqual(
    spans.map((s) => [s.name, s.outcome, s.duration_ms, s.attributes?.input]),
    [
      ['Bash', 'failed', 300, 'pnpm test'],
      ['Read', 'failed', 300, '/a.ts'],
      ['Edit', 'failed', 0, '/b.ts'],
    ],
    'calls without a result close as failed; inputs keep the path, never file contents',
  );
  assert.equal(spans[0]!.error, 'exit 1');
  assert.equal(spans[1]!.error, 'no result');
});

test('span helpers: ids, task class and record validation', () => {
  assert.match(newTraceId(), /^[0-9a-f]{32}$/);
  assert.match(newSpanId(), /^[0-9a-f]{16}$/);
  assert.equal(taskClass({ kind: 'code', loe: 'S' }), 'code/S');
  assert.equal(taskClass(undefined), undefined);
  assert.equal(toolSummary({ content: 'x' }), undefined);
  const span = {
    trace_id: 't',
    span_id: 's',
    type: 'model',
    name: 'coder',
    project: 'app',
    started_at: '2026-11-17T00:00:00.000Z',
    ended_at: '2026-11-17T00:00:01.000Z',
    outcome: 'completed',
    cost_usd: null,
  };
  assert.equal(SpanRecord.parse(span).cost_usd, null, 'a missing cost stays null, never 0');
  assert.throws(() => SpanRecord.parse({ ...span, type: 'nope' }));
});
