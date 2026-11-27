import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TaskBoard, type BoardIssue } from '@/components/task-board';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/actions', () => ({
  archiveIssue: vi.fn(),
  createIssue: vi.fn(),
  moveIssue: vi.fn(),
  refreshReviews: vi.fn(),
}));

const budget =
  "Devin spent the budget for this task ($20.08 of $15.00). Raise Devin's budget per task in the agent's settings, then reply here to continue.";

function card(run: BoardIssue['run']): BoardIssue {
  return {
    key: 'FE-15',
    title: 'Over budget',
    description: '',
    status: 'blocked',
    updated_at: '2026-11-25T12:00:00.000Z',
    run,
  };
}

describe('the board says why a run waits for a person', () => {
  it('shows the reason of a blocked run on its card, with the full text on hover', () => {
    const html = renderToStaticMarkup(
      <TaskBoard project="demo" now={0} issues={[card({ id: 'r1', stage: 'blocked', reason: budget })]} />,
    );
    const escaped = budget.replaceAll("'", '&#x27;');
    expect(html).toContain(`>${escaped}</p>`);
    expect(html).toContain(`title="${escaped}"`);
  });

  it('shows no reason while a new turn waits in the queue', () => {
    const html = renderToStaticMarkup(
      <TaskBoard
        project="demo"
        now={0}
        issues={[card({ id: 'r1', stage: 'blocked', reason: budget, waiting: true, waiting_for: 'slot' })]}
      />,
    );
    expect(html).not.toContain('spent the budget');
  });
});
