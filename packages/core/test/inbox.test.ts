import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inboxItems } from '../src/inbox.ts';
import { Feature } from '../src/features.ts';
import type { TaskRecord } from '../src/schemas.ts';

const task = (id: string, stage: TaskRecord['stage'], extra: Partial<TaskRecord> = {}): TaskRecord =>
  ({
    id,
    project: 'app',
    repo: '/r',
    prompt: `Task ${id}\nmore`,
    stage,
    updated_at: `2026-11-17T0${id.length}:00:00.000Z`,
    ...extra,
  }) as TaskRecord;

test('one rule: only what needs a human decision and has no agent on it waits in the inbox', () => {
  const base = {
    project: 'app',
    idea: 'x',
    created_at: '2026-11-17T00:00:00.000Z',
    updated_at: '2026-11-17T01:00:00.000Z',
  };
  const ticket = (id: string, state: string, blocked_by: string[] = [], task_id?: string) => ({
    id,
    title: `Ticket ${id}`,
    description: 'd',
    acceptance: ['a'],
    blocked_by,
    size: 'S',
    state,
    ...(task_id ? { task_id } : {}),
  });
  const features = [
    Feature.parse({
      ...base,
      id: 'asked',
      title: 'Asked',
      stage: 'grilling',
      grill: { turns: [{ at: '2026-11-17T02:00:00.000Z', role: 'agent', text: 'Q1: who?' }] },
    }),
    Feature.parse({
      ...base,
      id: 'busy',
      title: 'Busy',
      stage: 'grilling',
      working: { action: 'grill', started_at: 'x' },
      grill: { turns: [{ at: 'x', role: 'agent', text: 'Q' }] },
    }),
    Feature.parse({
      ...base,
      id: 'spec',
      title: 'Spec',
      stage: 'spec',
      spec: { written_at: '2026-11-17T03:00:00.000Z' },
    }),
    Feature.parse({
      ...base,
      id: 'impl',
      title: 'Impl',
      stage: 'implementing',
      tickets: [
        ticket('T1', 'done'),
        ticket('T2', 'done'),
        ticket('T3', 'waiting', ['T1', 'T2']),
        ticket('T4', 'failed', [], 'ft'),
      ],
    }),
  ];
  const items = inboxItems({
    project: 'app',
    tasks: [
      task('g', 'awaiting-approval', {
        verification: { passed: true, head_sha: 'h', at: 'x', output_tail: '', runtime: 'unknown' },
      }),
      task('cc', 'coding'),
      task('ft', 'failed'),
      task('bbb', 'blocked', {
        verdict: {
          intake_id: 'i',
          kind: 'code',
          loe: 'S',
          readiness: 'needs-clarification',
          blockers: [{ kind: 'clarification', question: 'Which page?' }],
        },
      }),
    ],
    features,
    reviews: [
      { number: 7, state: 'completed', finished_at: '2026-11-17T05:00:00.000Z', decision: 'Comment' },
      { number: 8, state: 'running' },
    ],
    tending: [
      {
        task_id: 'x',
        number: 9,
        url: 'u',
        reason: '3 fixes did not make the PR green',
        since: '2026-11-17T06:00:00.000Z',
      },
    ],
  });
  assert.deepEqual(
    items.map((i) => [i.kind, i.task_id ?? i.feature_id ?? i.pr?.number, i.ticket ?? null]),
    [
      ['gate', 'g', null],
      ['merge', 'impl', 'T3'],
      ['failed', 'ft', 'T4'],
      ['question', 'asked', null],
      ['blocked', 'bbb', null],
      ['approve-spec', 'spec', null],
      ['review', 7, null],
      ['tending', 'x', null],
    ],
  );
  assert.match(items[0]!.detail!, /runtime check says "unknown"/);
  assert.equal(items.find((i) => i.kind === 'blocked')!.detail, 'Which page?');
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'ids are unique');
});
