import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '@factory/core';
import { overview, ACTIVITY_WEEKS } from '@/lib/overview';
import { aggregateLog } from '@/lib/team-log';

describe('aggregateLog', () => {
  it('merges authors by email, keeps their latest name, and sorts by commits', () => {
    const log = [
      ['Ana', 'ANA@x.dev', '2026-01-02T10:00:00+01:00'],
      ['Ana María', 'ana@x.dev', '2026-03-01T10:00:00-05:00'],
      ['Bo', 'bo@x.dev', '2026-02-01T10:00:00Z'],
      ['Ana', 'ana@x.dev', '2025-12-01T10:00:00Z'],
    ]
      .map((f) => f.join('\x1f'))
      .join('\n');
    expect(aggregateLog(`${log}\n`)).toEqual([
      {
        email: 'ana@x.dev',
        name: 'Ana María',
        commits: 3,
        firstCommit: '2025-12-01T10:00:00Z',
        lastCommit: '2026-03-01T10:00:00-05:00',
      },
      {
        email: 'bo@x.dev',
        name: 'Bo',
        commits: 1,
        firstCommit: '2026-02-01T10:00:00Z',
        lastCommit: '2026-02-01T10:00:00Z',
      },
    ]);
  });
});

const task = (over: Partial<TaskRecord>): TaskRecord =>
  ({
    id: crypto.randomUUID(),
    project: 'p',
    repo: '/r',
    prompt: 'x',
    stage: 'queued',
    ...over,
  }) as TaskRecord;

describe('overview', () => {
  const now = new Date(2026, 10, 16, 12);
  const tasks = [
    task({
      stage: 'awaiting-approval',
      created_at: new Date(2026, 10, 3).toISOString(),
      events: [{ at: new Date(2026, 10, 16, 9).toISOString(), kind: 'stage:coding', message: '' }],
      attempts: [
        {
          step: 'coder',
          rung: 'a',
          model: 'm',
          effort: 'low',
          started_at: '',
          finished_at: new Date(2026, 10, 3).toISOString(),
          outcome: 'completed',
          cost_usd: 1.5,
        },
      ],
    }),
    task({
      stage: 'pr-opened',
      created_at: new Date(2026, 9, 3).toISOString(),
      pr: { url: 'u', branch: 'b', head_sha: 'h', at: new Date(2026, 9, 4).toISOString() },
    }),
  ];

  it('counts activity per day ending today and lists what needs you', () => {
    const o = overview(tasks, now);
    expect(o.activity).toHaveLength(ACTIVITY_WEEKS * 7);
    expect(o.activity.at(-1)).toEqual({ date: '2026-11-16', count: 1 });
    expect(o.activityTotal).toBe(1);
    expect(o.needsYou.map((t) => t.stage)).toEqual(['awaiting-approval']);
  });

  it('compares this month with last month', () => {
    expect(overview(tasks, now).month).toEqual([
      { label: 'Tasks started', value: '1', delta: '+0' },
      { label: 'Pull requests opened', value: '0', delta: '−1' },
      { label: 'Model spend', value: '$1.50', delta: '+$1.50' },
    ]);
  });
});
