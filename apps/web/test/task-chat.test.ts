import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '@factory/core';
import {
  lastStepId,
  latestActivity,
  runStatus,
  splitOutput,
  stageTimeline,
  taskConversation,
} from '@/lib/task-chat';

const at = (m: number) => `2026-11-14T00:${String(m).padStart(2, '0')}:00.000Z`;

const task = {
  id: '00000000-0000-4000-8000-000000000000',
  project: 'demo',
  repo: '/tmp/demo',
  prompt: 'Add a button',
  stage: 'pr-opened',
  created_at: at(0),
  approval: { decision: 'approved', head_sha: 'abc', at: at(9), note: 'Ship it' },
  events: [
    { at: at(0), kind: 'stage:queued', message: 'Task submitted' },
    { at: at(1), kind: 'stage:coding', message: 'Coder on sonnet-medium' },
    { at: at(2), kind: 'verification', message: 'Verification passed' },
    { at: at(3), kind: 'stage:awaiting-approval', message: 'Reviewer: approve, 2 finding(s)' },
    { at: at(4), kind: 'revision', message: 'Rename it' },
    { at: at(5), kind: 'stage:coding', message: 'Coder on sonnet-medium' },
    { at: at(6), kind: 'verification', message: 'Verification failed' },
    { at: at(7), kind: 'stage:awaiting-approval', message: 'Reviewer: approve, 0 finding(s)' },
    { at: at(9), kind: 'stage:approved', message: 'Approved abc' },
    { at: at(10), kind: 'stage:pr-opened', message: 'https://github.com/o/r/pull/1' },
  ],
} as unknown as TaskRecord;

describe('taskConversation', () => {
  it('alternates your messages with grouped agent turns', () => {
    const entries = taskConversation(task);
    expect(entries.map((e) => e.role)).toEqual(['user', 'agent', 'user', 'agent', 'user', 'agent']);
    expect(entries[0]).toMatchObject({ role: 'user', text: 'Add a button' });
    expect(entries[2]).toMatchObject({ label: 'Asked for changes', text: 'Rename it' });
    expect(entries[4]).toMatchObject({ label: 'Approved', text: 'Approved abc\n\nShip it' });
  });

  it('marks failures, decisions and the pull request link', () => {
    const steps = taskConversation(task).flatMap((e) => (e.role === 'agent' ? e.steps : []));
    expect(steps.map((s) => s.tone)).toEqual([
      'neutral',
      'success',
      'attention',
      'neutral',
      'danger',
      'attention',
      'success',
    ]);
    expect(steps.at(-1)?.href).toBe('https://github.com/o/r/pull/1');
  });

  it('finds the latest step of a kind', () => {
    expect(lastStepId(taskConversation(task), 'stage:awaiting-approval')).toBe('e7');
  });

  it('shows only the prompt for a task without events', () => {
    expect(taskConversation({ ...task, events: undefined })).toHaveLength(1);
  });
});

describe('splitOutput', () => {
  it('keeps a one-line message as text', () => {
    expect(splitOutput('Verification passed')).toEqual({ text: 'Verification passed' });
  });

  it('moves command output after the first line into a block, without terminal colors', () => {
    const message =
      'Worktree setup (`pnpm install`) exited with status 1. Fix the setup command.\n' +
      '. pnpm:devPreinstall$ mise run auth\n\u001b[31maws: [ERROR]\u001b[0m Token has expired\n';
    expect(splitOutput(message)).toEqual({
      text: 'Worktree setup (`pnpm install`) exited with status 1. Fix the setup command.',
      output: '. pnpm:devPreinstall$ mise run auth\naws: [ERROR] Token has expired',
    });
  });

  it('gives a failed step its output', () => {
    const failed = {
      ...task,
      stage: 'failed',
      events: [{ at: at(1), kind: 'stage:failed', message: 'Setup failed.\nline 1\nline 2' }],
    } as unknown as TaskRecord;
    const steps = taskConversation(failed).flatMap((e) => (e.role === 'agent' ? e.steps : []));
    expect(steps[0]).toMatchObject({ text: 'Setup failed.', output: 'line 1\nline 2', tone: 'danger' });
  });
});

describe('latestActivity', () => {
  it('names the latest command, tool call or step, not install progress', () => {
    const log = [
      'Coder attempt 1/3 on sonnet-medium (claude-sonnet-5-5, medium)…',
      '  · Bash pnpm outdated -r',
      '$ pnpm install --frozen-lockfile   # setup',
      'Progress: resolved 3784, reused 3783, downloaded 1, added 3783',
      '\u001b[32mProgress: resolved 3785\u001b[0m',
    ].join('\n');
    expect(latestActivity(log)).toBe('$ pnpm install --frozen-lockfile   # setup');
    expect(latestActivity('  · Read src/app.ts\nsome output')).toBe('Read src/app.ts');
    expect(latestActivity('nothing useful')).toBeUndefined();
  });
});

describe('stageTimeline', () => {
  const events = [
    { at: at(0), kind: 'stage:queued', message: 'Task submitted' },
    { at: at(1), kind: 'stage:coding', message: 'Coder on sonnet-medium' },
  ];
  const now = Date.parse(at(3));

  it('marks the current stage running while a run works', () => {
    const stages = stageTimeline(events, { busy: true, label: 'Running', now });
    expect(stages.map((s) => s.status)).toEqual(['done', 'running']);
  });

  it('adds a running step when the latest stage is already finished', () => {
    const failed = [
      ...events,
      { at: at(2), kind: 'stage:failed', message: 'coder made no changes\nCoder said: x' },
    ];
    const stages = stageTimeline(failed, { busy: true, label: 'Revising: code → verify → review', now });
    expect(stages.map((s) => [s.title, s.status])).toEqual([
      ['Task submitted', 'done'],
      ['Coder on sonnet-medium', 'done'],
      ['coder made no changes', 'failed'],
      ['Revising: code → verify → review', 'running'],
    ]);
    expect(stages.at(-1)).toMatchObject({ parent: 'stage-2', at: 3 * 60_000 });
  });

  it('shows no running step when nothing runs', () => {
    expect(stageTimeline(events, { busy: false, label: 'x', now }).map((s) => s.status)).toEqual([
      'done',
      'done',
    ]);
  });
});

describe('runStatus', () => {
  const t = (s: number) => new Date(Date.parse(at(0)) + s * 1000).toISOString();
  const now = Date.parse(at(0)) + 900_000;

  it('names the running command with its elapsed time and the silence since its last output', () => {
    expect(
      runStatus(
        { run_started_at: t(0), command: 'pnpm install', command_started_at: t(0), last_output_at: t(60) },
        '',
        now,
      ),
    ).toEqual({ text: '$ pnpm install', elapsed: '15m', silent: '14m', quiet: true });
  });

  it('is not quiet while output keeps coming, and falls back to the latest log activity', () => {
    expect(runStatus({ run_started_at: t(0), last_output_at: t(890) }, '  · Bash pnpm test', now)).toEqual({
      text: 'Bash pnpm test',
      elapsed: '15m',
      quiet: false,
    });
  });

  it('works without activity from an older backend', () => {
    expect(runStatus(undefined, '$ pnpm lint', now)).toEqual({ text: '$ pnpm lint', quiet: false });
  });
});

describe('coder messages', () => {
  const said =
    "coder made no changes\nCoder's last message:\nI made no changes.\n\n| Package | Latest |\n|---|---|\n| pg | 8.23.1 |";
  const failed = {
    ...task,
    stage: 'failed',
    events: [
      { at: at(1), kind: 'stage:coding', message: 'Coder on sonnet-medium' },
      { at: at(2), kind: 'attempt', message: `Coder failed: ${said}` },
      { at: at(2), kind: 'stage:failed', message: said },
    ],
  } as unknown as TaskRecord;

  it("shows the coder's last message once, as a message, on the failed stage", () => {
    const steps = taskConversation(failed).flatMap((e) => (e.role === 'agent' ? e.steps : []));
    expect(steps[1]).toMatchObject({ text: 'Coder failed: coder made no changes' });
    expect(steps[1]!.output).toBeUndefined();
    expect(steps[1]!.reply).toBeUndefined();
    expect(steps[2]).toMatchObject({ text: 'coder made no changes', tone: 'danger' });
    expect(steps[2]!.reply).toMatch(/^I made no changes\.\n\n\| Package/);
    expect(steps[2]!.output).toBeUndefined();
  });
});
