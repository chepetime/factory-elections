import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '@factory/core';
import { lastStepId, splitOutput, taskConversation } from '@/lib/task-chat';

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
