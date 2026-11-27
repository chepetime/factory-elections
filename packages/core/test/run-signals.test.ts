import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankWaste, runSignals } from '../src/run-signals.ts';
import type { SpanRecord } from '../src/trace.ts';

let n = 0;
const span = (x: Partial<SpanRecord> & Pick<SpanRecord, 'type'>): SpanRecord => ({
  trace_id: 't1',
  span_id: `s${++n}`,
  name: x.type,
  project: 'app',
  started_at: `2026-11-16T10:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`,
  ended_at: `2026-11-16T11:00:00.000Z`,
  outcome: 'completed',
  ...x,
});

const run = (trace_id = 't1', verification = ['pnpm test']) =>
  span({ type: 'run', trace_id, replay: { repo: '/r', prompt: 'p', verification } });
const tool = (name: string, input: string, outcome: 'completed' | 'failed' = 'completed', trace_id = 't1') =>
  span({ type: 'tool', trace_id, name, outcome, attributes: { input } });
const model = (x: Partial<SpanRecord> = {}) => span({ type: 'model', step: 'coder', ...x });

test('edit churn counts edits of one path', () => {
  const edits = [
    ...Array.from({ length: 9 }, () => tool('Edit', 'src/a.ts')),
    tool('Edit', 'src/b.ts'),
    tool('Edit', 'src/b.ts'),
  ];
  const [s] = runSignals([run(), model({ cost_usd: 1 }), ...edits]);
  assert.equal(s!.edit_churn, 9);
  assert.equal(s!.tool_calls, 11);
  assert.equal(s!.wasted_calls, 8, 'the edits after the first of the churned path');
  assert.equal(s!.category, 'thrash');
  assert.equal(s!.repeated_calls, 0, 'edits are churn, not repeats');
});

test('a fail-fix loop needs fail, edit, fail of the same check', () => {
  const loop = [
    tool('Bash', 'pnpm test', 'failed'),
    tool('Edit', 'src/a.ts'),
    tool('Bash', 'pnpm test', 'failed'),
  ];
  const noEdit = [tool('Bash', 'pnpm test', 'failed', 't2'), tool('Bash', 'pnpm test', 'failed', 't2')];
  const fixed = [
    tool('Bash', 'pnpm test', 'failed', 't3'),
    tool('Edit', 'src/a.ts', 'completed', 't3'),
    tool('Bash', 'pnpm test', 'completed', 't3'),
  ];
  const otherCheck = [
    tool('Bash', 'pnpm test', 'failed', 't4'),
    tool('Edit', 'src/a.ts', 'completed', 't4'),
    tool('Bash', 'pnpm lint', 'failed', 't4'),
  ];
  const byTrace = Object.fromEntries(
    runSignals([
      run('t1'),
      run('t2'),
      run('t3'),
      run('t4', ['pnpm test', 'pnpm lint']),
      ...loop,
      ...noEdit,
      ...fixed,
      ...otherCheck,
    ]).map((s) => [s.trace_id, s]),
  );
  assert.equal(byTrace.t1!.fail_fix_loops, 1);
  assert.equal(byTrace.t1!.category, 'thrash');
  assert.equal(byTrace.t2!.fail_fix_loops, 0, 'two fails with no edit between are not a loop');
  assert.equal(byTrace.t3!.fail_fix_loops, 0, 'a pass ends the loop');
  assert.equal(byTrace.t4!.fail_fix_loops, 0, 'another check failing is not the same check');
  assert.equal(byTrace.t2!.max_failure_streak, 2);
});

test('observations are not repeats', () => {
  const observed = [
    ...Array.from({ length: 5 }, () => tool('Read', 'src/a.ts')),
    ...Array.from({ length: 4 }, () => tool('Bash', 'ls -la src')),
    ...Array.from({ length: 3 }, () => tool('Bash', 'git status')),
    ...Array.from({ length: 3 }, () => tool('mcp__browser__screenshot', '')),
  ];
  const [seen] = runSignals([run(), ...observed]);
  assert.equal(seen!.repeated_calls, 0);
  assert.equal(seen!.oscillations, 0);
  assert.equal(seen!.wasted_calls, 0);
  assert.equal(seen!.category, 'fine');

  const builds = Array.from({ length: 4 }, (_, i) => tool('Bash', `pnpm build --run ${i}`));
  const [repeated] = runSignals([run(), ...builds]);
  assert.equal(repeated!.repeated_calls, 3, 'numbers are blanked, so the four builds are one call');
});

test('A/B/A/B calls are one oscillation', () => {
  const calls = ['a', 'b', 'a', 'b', 'a'].map((x) => tool('Edit', `src/${x}.ts`));
  const [s] = runSignals([run(), ...calls]);
  assert.equal(s!.oscillations, 1);
  assert.equal(s!.wasted_calls, 3);
});

test('a Codex run ranks by tokens with unknown cost', () => {
  const repeats = (trace: string, count: number) =>
    Array.from({ length: count }, () => tool('Bash', 'pnpm build', 'completed', trace));
  const signals = runSignals([
    run('known'),
    model({ trace_id: 'known', cost_usd: 0.4, tokens: { input: 1000, output: 100 } }),
    ...repeats('known', 4),
    run('codex-a'),
    model({ trace_id: 'codex-a', cost_usd: null, tokens: { input: 9000, output: 1000 } }),
    ...repeats('codex-a', 4),
    run('codex-b'),
    model({ trace_id: 'codex-b', cost_usd: null, tokens: { input: 2000, output: 200 } }),
    ...repeats('codex-b', 4),
  ]);
  const by = Object.fromEntries(signals.map((s) => [s.trace_id, s]));
  assert.equal(by['codex-a']!.wasted_usd, null, 'unknown, never $0');
  assert.equal(by['codex-a']!.wasted_tokens, 7500);
  assert.equal(by.known!.wasted_usd, 0.4 * 0.75);
  assert.deepEqual(
    rankWaste(signals).map((s) => s.trace_id),
    ['known', 'codex-a', 'codex-b'],
    'known dollars first, then unknown cost by tokens',
  );
});

test('a run names its source and the tool and input shape of its main waste', () => {
  const calls = Array.from({ length: 4 }, (_, i) => tool('Bash', `pnpm build --run ${i}${i}${i}${i}`));
  const [s] = runSignals([run(), model({ provider: 'claude' }), ...calls]);
  assert.equal(s!.source, 'claude');
  assert.deepEqual(s!.pattern, { kind: 'repeat', tool: 'Bash', shape: 'pnpm build --run #' });
  const [clean] = runSignals([run('t2'), tool('Read', 'src/a.ts', 'completed', 't2')]);
  assert.equal(clean!.pattern, undefined);
  assert.equal(clean!.source, 'run', 'no model span: the run name');
});

test('an empty final message from the coder counts as an error', () => {
  const [s] = runSignals([run(), model({ attributes: { final_chars: 0 } }), tool('Edit', 'src/a.ts')]);
  assert.equal(s!.empty_answers, 1);
  assert.equal(s!.category, 'errors');
});
