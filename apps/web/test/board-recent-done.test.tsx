import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { recentDone, TaskBoard, type BoardIssue } from '@/components/task-board';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/actions', () => ({
  archiveIssue: vi.fn(),
  createIssue: vi.fn(),
  moveIssue: vi.fn(),
  refreshReviews: vi.fn(),
}));

const now = Date.parse('2026-11-27T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
const done = (n: number, minutes: number): BoardIssue => ({
  key: `DE-${n}`,
  title: `Done ${n}`,
  description: '',
  status: 'done',
  updated_at: minutesAgo(minutes),
});

describe('the Done column', () => {
  it('keeps only tasks done in the last hour, newest first, at most 5', () => {
    const cards = [done(1, 10), done(2, 70), done(3, 5), done(4, 1), done(5, 20), done(6, 30), done(7, 40)];
    expect(recentDone(cards, now).map((c) => c.key)).toEqual(['DE-4', 'DE-3', 'DE-1', 'DE-5', 'DE-6']);
    expect(recentDone([done(8, 61)], now)).toEqual([]);
  });

  it('still counts every Done task, and shows only the recent ones', () => {
    const issues = [done(1, 10), done(2, 120), done(3, 5)];
    const html = renderToStaticMarkup(<TaskBoard project="demo" issues={issues} now={now} />);
    const column = html.slice(html.indexOf('id="column-done"'));
    const section = column.slice(0, column.indexOf('</section>'));
    expect(section).toContain('>3</span>');
    expect(section).toContain('Done 1');
    expect(section).toContain('Done 3');
    expect(section).not.toContain('Done 2');
  });
});
