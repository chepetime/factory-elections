import { describe, expect, it } from 'vitest';
import { modelTotals, ticketTimeline } from '@/lib/ticket-timeline';

const attempt = (step: string, model: string, cost: number | null, outcome = 'completed') => ({
  step,
  rung: 'r',
  model,
  effort: 'high' as const,
  started_at: '2026-11-25T23:12:00.000Z',
  finished_at: '2026-11-25T23:20:00.000Z',
  outcome: outcome as 'completed' | 'failed',
  cost_usd: cost,
});
const issue = {
  created_at: '2026-11-25T22:50:00.000Z',
  runs: ['r1', 'r2'],
  events: [
    { at: '2026-11-25T22:50:00.000Z', kind: 'created', message: 'Created from a factory run' },
    { at: '2026-11-25T23:07:00.000Z', kind: 'edit:title', message: 'Changed the title' },
    { at: '2026-11-25T23:08:00.000Z', kind: 'edit:description', message: 'Changed the description' },
    { at: '2026-11-25T23:09:00.000Z', kind: 'edit:title', message: 'Changed the title' },
    { at: '2026-11-25T23:11:00.000Z', kind: 'route', message: 'Mika chose Devin' },
    { at: '2026-11-25T23:11:00.000Z', kind: 'move:in_progress', message: 'Started a run' },
    { at: '2026-11-25T23:24:00.000Z', kind: 'move:in_review', message: 'Devin changed status to In review' },
    { at: '2026-11-25T23:30:00.000Z', kind: 'comment', message: 'Hi' },
    { at: '2026-11-26T18:23:00.000Z', kind: 'follow-up', message: 'Added a follow-up for Devin: conflicts' },
    { at: '2026-11-26T19:23:00.000Z', kind: 'move:in_progress', message: 'Ran again' },
    { at: '2026-11-26T19:38:00.000Z', kind: 'review-loop', message: 'Review loop stopped: no result.' },
  ],
};
const records = [
  {
    created_at: '2026-11-25T22:50:00.000Z',
    updated_at: '2026-11-25T23:03:00.000Z',
    stage: 'rejected' as const,
    workflow: 'pipeline' as const,
    attempts: [attempt('coder', 'claude-opus-5-5', 1)],
  },
  {
    created_at: '2026-11-25T23:11:30.000Z',
    updated_at: '2026-11-26T19:38:00.000Z',
    stage: 'pr-opened' as const,
    workflow: 'agent' as const,
    agent: 'devin',
    attempts: [
      attempt('agent', 'claude-sonnet-5-5', 2),
      attempt('agent', 'claude-sonnet-5-5', 3, 'failed'),
      attempt('pr-writer', 'claude-sonnet-5-5', null),
      { ...attempt('agent', 'claude-haiku-5-5', 0.5), started_at: '2026-11-26T19:24:00.000Z' },
    ],
    verification: { passed: true, head_sha: 'a', at: '2026-11-25T23:22:00.000Z', output_tail: '' },
    approval: { decision: 'approved' as const, head_sha: 'a', at: '2026-11-25T23:40:00.000Z' },
    pr: { url: 'https://github.com/o/r/pull/4', branch: 'b', head_sha: 'a', at: '2026-11-25T23:41:00.000Z' },
  },
];
const names = { creator: 'the factory', agent: (id?: string) => (id === 'devin' ? 'Devin' : id) };

describe('ticketTimeline', () => {
  const entries = ticketTimeline(issue, records, names);

  it('puts ticket events and run steps on one line, oldest first', () => {
    expect(entries.map((e) => e.title)).toEqual([
      'Created',
      'Run 1 started',
      'Run 1: Rejected',
      'Edited the title and description',
      'Mika chose Devin',
      'Run 2 started',
      'Checks passed',
      'Devin changed status to In review',
      'You approved the change',
      'PR #4 opened',
      'Follow-up added',
      'Ran again',
      'Review loop stopped: no result.',
    ]);
  });

  it('names the creator and the run agent, links the PR, and marks failures', () => {
    expect(entries[0]!.detail).toBe('by the factory');
    expect(entries.find((e) => e.title === 'Run 2 started')!.detail).toBe('Devin');
    expect(entries.find((e) => e.title === 'Run 1 started')!.detail).toBe('Pipeline');
    expect(entries.find((e) => e.kind === 'pr')!.href).toBe('https://github.com/o/r/pull/4');
    expect(entries.find((e) => e.title.startsWith('Review loop'))!.tone).toBe('bad');
    expect(entries.find((e) => e.title === 'Run 1: Rejected')!.tone).toBe('bad');
  });

  it('lists the models of each turn by step, with calls, failures and cost', () => {
    expect(entries.find((e) => e.title === 'Run 2 started')!.models).toEqual([
      { model: 'claude-sonnet-5-5', step: 'agent', calls: 2, failed: 1, cost_usd: 5 },
      { model: 'claude-sonnet-5-5', step: 'pr-writer', calls: 1, failed: 0, cost_usd: null },
    ]);
    // A later turn of the same run (after the follow-up) keeps its own models.
    expect(entries.find((e) => e.title === 'Ran again')!.models).toEqual([
      { model: 'claude-haiku-5-5', step: 'agent', calls: 1, failed: 0, cost_usd: 0.5 },
    ]);
  });

  it('keeps the "Started a run" status event when no run record loaded', () => {
    const titles = ticketTimeline(issue, [undefined, undefined], names).map((e) => e.title);
    expect(titles).toContain('Started a run');
    expect(titles).toContain('Ran again');
  });
});

describe('review turns', () => {
  const reviews = [
    {
      at: '2026-11-26T19:37:00.000Z',
      name: 'review',
      model: 'claude-opus-5-5',
      outcome: 'completed',
      cost_usd: 0.79,
      pr: { number: 4 },
    },
    {
      at: '2026-11-26T19:50:00.000Z',
      name: 'review reply',
      model: 'claude-opus-5-5',
      outcome: 'failed',
      cost_usd: null,
    },
  ];
  it('puts each senior PR review turn on the line with its model and cost', () => {
    const entries = ticketTimeline(issue, records, names, reviews).filter((e) =>
      e.title.startsWith('Senior'),
    );
    expect(entries.map((e) => [e.title, e.detail, e.tone])).toEqual([
      ['Senior PR review turn', 'PR #4', undefined],
      ['Senior PR review reply', undefined, 'bad'],
    ]);
    expect(entries[0]!.models).toEqual([
      { model: 'claude-opus-5-5', step: 'review', calls: 1, failed: 0, cost_usd: 0.79 },
    ]);
  });
  it('adds review models to the totals without counting them as task runs', () => {
    const opus = modelTotals(records, reviews).find((m) => m.model === 'claude-opus-5-5')!;
    expect(opus).toEqual({
      model: 'claude-opus-5-5',
      calls: 3,
      failed: 1,
      cost_usd: null,
      steps: ['coder', 'review'],
      runs: 1,
    });
  });
});

describe('modelTotals', () => {
  it('sums every model over the runs, most calls first, unknown cost stays unknown', () => {
    expect(modelTotals(records)).toEqual([
      {
        model: 'claude-sonnet-5-5',
        calls: 3,
        failed: 1,
        cost_usd: null,
        steps: ['agent', 'pr-writer'],
        runs: 1,
      },
      { model: 'claude-opus-5-5', calls: 1, failed: 0, cost_usd: 1, steps: ['coder'], runs: 1 },
      { model: 'claude-haiku-5-5', calls: 1, failed: 0, cost_usd: 0.5, steps: ['agent'], runs: 1 },
    ]);
  });
});
