import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TaskBoard, type BoardIssue } from '@/components/task-board';

vi.mock('@factory/backend-client', () => ({ backendCall: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/actions', () => ({
  archiveIssue: vi.fn(),
  createIssue: vi.fn(),
  moveIssue: vi.fn(),
  refreshReviews: vi.fn(),
}));

const card = (key: string, status: BoardIssue['status'], waits_for?: string[]): BoardIssue => ({
  key,
  title: `Title ${key}`,
  description: '',
  status,
  updated_at: '2026-11-26T00:00:00.000Z',
  ...(waits_for ? { waits_for } : {}),
});

describe('ticket blockers on the board', () => {
  it('shows a Todo ticket with open blockers as waiting for them', () => {
    const html = renderToStaticMarkup(
      <TaskBoard
        project="demo"
        now={0}
        issues={[
          card('FE-22', 'todo', ['FE-21']),
          card('FE-23', 'in_progress', ['FE-21']),
          card('FE-24', 'todo'),
        ]}
      />,
    );
    expect(html.split('Waits for FE-21')).toHaveLength(2);
    const todo = html.slice(html.indexOf('id="column-todo"'));
    expect(todo.slice(0, todo.indexOf('</section>'))).toContain('Waits for FE-21');
  });
});
