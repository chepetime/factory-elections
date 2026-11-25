import { expect, it } from 'vitest';
import type { TaskRecord } from '@factory/core';
import { overview } from '@/lib/overview';
import { projectStats } from '@/lib/workspace-home';

const run = (id: string, stage: TaskRecord['stage']) =>
  ({ id, project: 'demo', repo: '/r', prompt: 'x', stage }) as TaskRecord;
const task = (id: string, owned?: boolean) => ({
  status: 'in_progress' as const,
  updated_at: '2026-11-25T00:00:00.000Z',
  run: { id, ...(owned === undefined ? {} : { owned }) },
});

it('counts runs by who moves next, with live ownership when the board reports it', () => {
  const runs = [
    run('live', 'failed'),
    run('stopped', 'coding'),
    run('new', 'queued'),
    run('approved', 'approved'),
    run('unknown', 'coding'),
  ];
  const stats = projectStats(runs, [task('live', true), task('stopped', false), task('new', false)]);
  // A live revision of a failed run works; an interrupted run needs you; a queued run waits.
  expect([stats.running, stats.needsYou]).toEqual([2, 2]);
  expect(overview(runs).needsYou.map((t) => t.id)).toContain('approved');
});
