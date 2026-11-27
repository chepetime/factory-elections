import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickFinding, type RetroFinding } from '../src/retro.ts';
import type { RunSignals } from '../src/run-signals.ts';

const NOW = new Date('2026-11-26T09:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const signal = (
  trace_id: string,
  source: string,
  wasted_usd: number | null,
  shape = 'pnpm build',
  tool = 'Bash',
): RunSignals => ({
  trace_id,
  project: 'app',
  task_id: `task-${trace_id}`,
  source,
  pattern: { kind: 'repeat', tool, shape },
  tool_calls: 10,
  edit_churn: 0,
  repeated_calls: 3,
  oscillations: 0,
  fail_fix_loops: 0,
  max_failure_streak: 0,
  empty_answers: 0,
  wasted_calls: 3,
  waste_ratio: 0.3,
  wasted_usd,
  wasted_tokens: 1000,
  category: 'thrash',
});
const three = (shape: string, usd: number, tool = 'Bash') => [
  signal(`${shape}-1`, 'claude', usd, shape, tool),
  signal(`${shape}-2`, 'codex', usd, shape, tool),
  signal(`${shape}-3`, 'claude', usd, shape, tool),
];
let n = 0;
const id = () => `f${++n}`;

test('two runs give no finding', () => {
  const r = pickFinding(three('pnpm build', 1).slice(0, 2), [], NOW, id);
  assert.equal(r.created, undefined);
  assert.deepEqual(r.findings, []);
});

test('three runs from one source give no finding', () => {
  const one = ['a', 'b', 'c'].map((t) => signal(t, 'claude', 1));
  assert.equal(pickFinding(one, [], NOW, id).created, undefined);
});

test('the costliest group wins, and only one finding is filed', () => {
  const r = pickFinding(
    [...three('pnpm build', 1), ...three('pnpm lint', 5), ...three('git push', 2)],
    [],
    NOW,
    id,
  );
  assert.equal(r.findings.length, 1);
  assert.match(r.created!.title, /pnpm lint/);
  assert.equal(r.created!.wasted_usd, 15);
  assert.equal(r.created!.occurrences, 3);
  assert.deepEqual(r.created!.evidence.task_ids, [
    'task-pnpm lint-1',
    'task-pnpm lint-2',
    'task-pnpm lint-3',
  ]);
});

test('a group of unknown cost ranks by tokens, below known dollars', () => {
  const cheap = three('a', 0.01);
  const unknown = three('b', 0).map((s) => ({ ...s, wasted_usd: null, wasted_tokens: 9_000_000 }));
  assert.match(pickFinding([...unknown, ...cheap], [], NOW, id).created!.title, /: a /);
  assert.equal(pickFinding(unknown, [], NOW, id).created!.wasted_usd, null);
});

test('a path or number in the input does not split a group', () => {
  const runs = [
    signal('a', 'claude', 1, 'pnpm build src/a.ts 123456'),
    signal('b', 'codex', 1, 'pnpm build lib/b.ts 987654'),
    signal('c', 'claude', 1, 'pnpm build x/c.ts 5551212'),
  ];
  assert.equal(pickFinding(runs, [], NOW, id).created?.occurrences, 3);
});

test('a repeat joins the open finding', () => {
  const first = pickFinding(three('pnpm build', 1), [], NOW, id);
  const again = [...three('pnpm build', 1), signal('new-run', 'codex', 1)];
  const r = pickFinding(again, first.findings, day(1), id);
  assert.equal(r.created, undefined);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0]!.occurrences, 4);
  assert.equal(r.findings[0]!.last_seen, day(1).toISOString());
  assert.equal(r.findings[0]!.first_seen, NOW.toISOString());
  // The same runs again change nothing: a daily retro never counts a run twice.
  const same = pickFinding(again, r.findings, day(2), id);
  assert.equal(same.findings[0]!.occurrences, 4);
  assert.equal(same.findings[0]!.last_seen, day(1).toISOString());
});

test('a dismissed fingerprint stays quiet for 14 days', () => {
  const first = pickFinding(three('pnpm build', 1), [], NOW, id);
  const dismissed: RetroFinding[] = first.findings.map((f) => ({
    ...f,
    status: 'dismissed',
    dismissed_at: NOW.toISOString(),
  }));
  const runs = three('pnpm build', 1);
  const quiet = pickFinding(runs, dismissed, day(13), id);
  assert.equal(quiet.created, undefined);
  assert.equal(quiet.findings[0]!.status, 'dismissed');
  const later = pickFinding(runs, dismissed, day(14), id);
  assert.equal(later.created?.status, 'open');
  assert.equal(later.findings.length, 1);
});

test('a tasked fingerprint is not filed again', () => {
  const first = pickFinding(three('pnpm build', 1), [], NOW, id);
  const tasked = first.findings.map((f): RetroFinding => ({ ...f, status: 'tasked', task_key: 'FE-9' }));
  assert.equal(pickFinding(three('pnpm build', 1), tasked, day(30), id).created, undefined);
});
