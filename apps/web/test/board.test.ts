import { describe, expect, it } from 'vitest';
import { needsPerson, runAttention, STAGES, type TaskRecord } from '@factory/core';
import { age, buildBoard, mayRun, type BoardPull, type BoardTask, type Column } from '@/lib/board';
import type { InboxItem } from '@/lib/inbox';

let n = 0;
function task(over: Partial<TaskRecord> = {}): TaskRecord {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    project: 'demo',
    repo: '/repos/demo',
    prompt: `Task ${n}\nmore detail`,
    stage: 'coding',
    created_at: '2026-11-24T10:00:00.000Z',
    updated_at: '2026-11-24T10:00:00.000Z',
    ...over,
  } as TaskRecord;
}
function inboxItem(t: TaskRecord, over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: `failed:${t.project}:${t.id}`,
    kind: 'failed',
    project: t.project,
    title: 'x',
    action: 'Read the log, then run again or reject',
    since: '2026-11-24T11:00:00.000Z',
    task_id: t.id,
    ...over,
  };
}
const pr = (branch: string, number: number) => ({
  url: `https://github.com/o/r/pull/${number}`,
  branch,
  head_sha: 'abc',
  at: '2026-11-24T12:00:00.000Z',
});
const pull = (branch: string, number: number, over: Partial<BoardPull> = {}): BoardPull => ({
  number,
  branch,
  url: `https://github.com/o/r/pull/${number}`,
  isDraft: false,
  decision: 'review',
  author: 'me',
  ...over,
});
function columnOf(board: ReturnType<typeof buildBoard>, id: string): Column | undefined {
  return (Object.keys(board.columns) as Column[]).find((c) =>
    board.columns[c].some((card) => card.id === id),
  );
}
const running = { phase: 'running' as const, label: 'Running classify → code → verify → review' };

describe('buildBoard', () => {
  it('puts each task in exactly one column and counts the rest as archived', () => {
    const tasks: BoardTask[] = [
      { task: task({ stage: 'coding' }), run: running },
      { task: task({ stage: 'blocked' }) },
      { task: task({ stage: 'awaiting-approval' }) },
      { task: task({ stage: 'approved' }) },
      { task: task({ stage: 'rejected' }) },
      { task: task({ stage: 'failed' }) },
    ];
    const board = buildBoard({ tasks, inbox: [] });
    const placed = Object.values(board.columns).flat();
    expect(placed).toHaveLength(4);
    expect(new Set(placed.map((c) => c.id)).size).toBe(4);
    expect(board.archived).toBe(2);
    expect(tasks.map((t) => columnOf(board, t.task.id))).toEqual([
      'working',
      'needs-me',
      'in-review',
      'ready',
      undefined,
      undefined,
    ]);
  });

  it('keeps a failed task in Needs me when the inbox could not be read', () => {
    const t = task({ stage: 'failed' });
    expect(columnOf(buildBoard({ tasks: [{ task: t }] }), t.id)).toBe('needs-me');
    expect(buildBoard({ tasks: [{ task: t }], inbox: [] }).archived).toBe(1);
  });

  it('lets a live run win over an open inbox item', () => {
    const t = task({ stage: 'failed' });
    const board = buildBoard({ tasks: [{ task: t, run: { phase: 'queued' } }], inbox: [inboxItem(t)] });
    expect(columnOf(board, t.id)).toBe('working');
  });

  it('puts a task with an open inbox item in Needs me, with the item text and time', () => {
    const t = task({ stage: 'failed' });
    const board = buildBoard({ tasks: [{ task: t, run: { phase: 'failed' } }], inbox: [inboxItem(t)] });
    const card = board.columns['needs-me'][0]!;
    expect(card.live).toEqual({
      text: 'Read the log, then run again or reject',
      tone: 'needs-me',
      at: '2026-11-24T11:00:00.000Z',
    });
    expect(card.action).toBeUndefined();
  });

  it('keeps a task at the gate In review: the gate item is the review, not an attention item', () => {
    const t = task({ stage: 'awaiting-approval' });
    const board = buildBoard({ tasks: [{ task: t }], inbox: [inboxItem(t, { kind: 'gate' })] });
    expect(columnOf(board, t.id)).toBe('in-review');
    expect(board.columns['in-review'][0]!.action).toMatchObject({ label: 'Review' });
  });

  it('ignores inbox items of another project with the same task id', () => {
    const t = task({ stage: 'failed' });
    const board = buildBoard({ tasks: [{ task: t }], inbox: [inboxItem(t, { project: 'other' })] });
    expect(board.archived).toBe(1);
  });

  it('archives a PR task whose PR is not open any more, only when the PR list is known', () => {
    const t = task({ stage: 'pr-opened', pr: pr('factory/a', 7) });
    expect(buildBoard({ tasks: [{ task: t }], pulls: { demo: [] } }).archived).toBe(1);
    const unknown = buildBoard({ tasks: [{ task: t }] });
    expect(unknown.archived).toBe(0);
    expect(columnOf(unknown, t.id)).toBe('in-review');
  });

  it('moves an approved, non-draft PR to Ready with a Merge link to the PR', () => {
    const t = task({ stage: 'pr-opened', pr: pr('factory/a', 7) });
    const board = buildBoard({
      tasks: [{ task: t }],
      pulls: { demo: [pull('factory/a', 7, { decision: 'approved' })] },
    });
    const card = board.columns.ready[0]!;
    expect(card.action).toEqual({ label: 'Merge', href: 'https://github.com/o/r/pull/7', external: true });
    expect(card.pr).toEqual({ number: 7, url: 'https://github.com/o/r/pull/7', author: 'me' });
  });

  it('keeps a draft or unapproved PR In review with its review state as the live line', () => {
    const draft = task({ stage: 'pr-opened', pr: pr('factory/a', 7) });
    const changes = task({ stage: 'pr-opened', pr: pr('factory/b', 8) });
    const board = buildBoard({
      tasks: [{ task: draft }, { task: changes }],
      pulls: {
        demo: [
          pull('factory/a', 7, { decision: 'approved', isDraft: true }),
          pull('factory/b', 8, { decision: 'changes' }),
        ],
      },
    });
    expect(board.columns['in-review'].map((c) => c.live.text).sort()).toEqual(['Changes requested', 'Draft']);
    expect(board.columns['in-review'].every((c) => !c.action)).toBe(true);
  });

  it('puts in Needs me and Ready only tasks the core rule says need you', () => {
    const stages = STAGES.map((stage) => task({ stage }));
    const { columns } = buildBoard({ tasks: stages.map((t) => ({ task: t })), inbox: [] });
    for (const card of [...columns['needs-me'], ...columns.ready])
      expect(needsPerson(runAttention(card.stage)), card.stage).toBe(true);
    expect(columns.ready.map((c) => c.stage)).toEqual(['approved']);
  });

  it('offers Open PR for an approved task without a PR', () => {
    const t = task({ stage: 'approved' });
    expect(buildBoard({ tasks: [{ task: t }] }).columns.ready[0]!.action).toEqual({
      label: 'Open PR',
      href: `/projects/demo/tasks/${t.id}`,
    });
  });

  it('uses the run command, then the latest event, then the run label for a working card', () => {
    const t = task({
      events: [
        { at: '2026-11-24T10:05:00.000Z', kind: 'stage:coding', message: 'Coding started\nsecond line' },
      ],
    });
    const withCommand = buildBoard({
      tasks: [
        {
          task: t,
          run: {
            phase: 'running',
            activity: {
              run_started_at: '2026-11-24T10:00:00.000Z',
              command: 'pnpm test',
              command_started_at: '2026-11-24T10:06:00.000Z',
            },
          },
        },
      ],
    });
    expect(withCommand.columns.working[0]!.live).toEqual({
      text: 'pnpm test',
      tone: 'working',
      at: '2026-11-24T10:06:00.000Z',
    });
    const withEvent = buildBoard({ tasks: [{ task: t, run: running }] });
    expect(withEvent.columns.working[0]!.live).toEqual({
      text: 'Coding started',
      tone: 'working',
      at: '2026-11-24T10:05:00.000Z',
    });
    const bare = buildBoard({ tasks: [{ task: task(), run: running }] });
    expect(bare.columns.working[0]!.live.text).toBe(running.label);
    expect(bare.columns.working[0]!.live.at).toBeUndefined();
  });

  it('shows an interrupted run in Working with a danger tone', () => {
    const t = task({ stage: 'coding' });
    const card = buildBoard({ tasks: [{ task: t, run: { phase: 'interrupted' } }] }).columns.working[0]!;
    expect(card.live).toMatchObject({ text: 'Run interrupted', tone: 'danger' });
  });

  it('puts blocked tasks in Needs me with the classifier questions', () => {
    const t = task({
      stage: 'blocked',
      verdict: {
        blockers: [{ question: 'Which API?' }, { question: 'Which page?' }],
      } as TaskRecord['verdict'],
    });
    expect(buildBoard({ tasks: [{ task: t }] }).columns['needs-me'][0]!.live.text).toBe(
      'Which API?; Which page?',
    );
  });

  it('never fabricates fields: no PR, author or action without data', () => {
    const t = task({ stage: 'coding', worktree: { path: '/w', branch: 'factory/x', base_branch: 'main' } });
    const card = buildBoard({ tasks: [{ task: t }] }).columns.working[0]!;
    expect(card).not.toHaveProperty('pr');
    expect(card).not.toHaveProperty('action');
    expect(card.resource).toEqual({ kind: 'branch', text: 'factory/x' });
    expect(card.title).toBe(`Task ${n}`);
    const repoOnly = buildBoard({ tasks: [{ task: task({ stage: 'queued' }) }] }).columns.working[0]!;
    expect(repoOnly.resource).toEqual({ kind: 'repo', text: 'demo' });
    // A PR that is not in the open list has no author: the list is the only source of people.
    const prTask = task({ stage: 'pr-opened', pr: pr('factory/y', 9) });
    expect(buildBoard({ tasks: [{ task: prTask }] }).columns['in-review'][0]!.pr).toEqual({
      number: 9,
      url: 'https://github.com/o/r/pull/9',
    });
  });

  it('orders each column newest first', () => {
    const old = task({ stage: 'awaiting-approval', updated_at: '2026-11-20T00:00:00.000Z' });
    const fresh = task({ stage: 'awaiting-approval', updated_at: '2026-11-24T00:00:00.000Z' });
    const ids = buildBoard({ tasks: [{ task: old }, { task: fresh }] }).columns['in-review'].map((c) => c.id);
    expect(ids).toEqual([fresh.id, old.id]);
  });
});

describe('helpers', () => {
  it('formats ages', () => {
    const now = Date.parse('2026-11-24T12:00:00.000Z');
    expect(age(undefined, now)).toBeUndefined();
    expect(age('2026-11-24T11:59:30.000Z', now)).toBe('now');
    expect(age('2026-11-24T11:57:00.000Z', now)).toBe('3m ago');
    expect(age('2026-11-24T09:00:00.000Z', now)).toBe('3h ago');
    expect(age('2026-11-20T12:00:00.000Z', now)).toBe('4d ago');
  });

  it('skips run lookups for tasks that cannot run', () => {
    expect(mayRun(task({ stage: 'rejected' }))).toBe(false);
    expect(mayRun(task({ stage: 'pr-opened', pr: pr('b', 1) }))).toBe(false);
    expect(mayRun(task({ stage: 'failed' }))).toBe(true);
  });
});
