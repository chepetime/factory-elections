import { expect, it } from 'vitest';
import type { TaskRecord } from '@factory/core';
import { projectStats } from '@/lib/workspace-home';

const run = (over: Partial<TaskRecord>): TaskRecord =>
  ({ id: 'a', project: 'demo', repo: '/r', prompt: 'p', stage: 'queued', ...over }) as TaskRecord;

it('counts open tasks, runs by state, PRs and this month spend', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  const attempt = (finished_at: string, cost_usd: number) =>
    ({ step: 'coder', started_at: finished_at, finished_at, outcome: 'completed', cost_usd }) as never;
  const stats = projectStats(
    [
      run({
        stage: 'coding',
        updated_at: '2026-11-20T00:00:00Z',
        attempts: [attempt('2026-11-20T00:00:00Z', 1.5)],
      }),
      run({ stage: 'awaiting-approval', attempts: [attempt('2026-10-10T00:00:00Z', 9)] }),
      run({ stage: 'pr-opened', pr: { url: 'u', branch: 'b', head_sha: 's', at: '2026-11-01T00:00:00Z' } }),
    ],
    [
      { status: 'todo', updated_at: '2026-11-24T00:00:00Z' },
      { status: 'done', updated_at: '2026-11-01T00:00:00Z' },
      { status: 'in_progress', updated_at: '2026-11-02T00:00:00Z', archived_at: '2026-11-03T00:00:00Z' },
    ],
    now,
  );
  expect(stats).toEqual({
    openTasks: 1,
    running: 1,
    needsYou: 1,
    pullRequests: 1,
    spendThisMonth: 1.5,
    lastActivity: '2026-11-24T00:00:00Z',
  });
});

it('has no last activity for an empty project', () => {
  expect(projectStats([], []).lastActivity).toBeUndefined();
});
