import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend-client';
import { tendPullRequestsNow } from '@/lib/factory';
import { TaskBoard } from '@/components/task-board';

vi.mock('@factory/backend-client', () => ({ backendCall: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/actions', () => ({
  archiveIssue: vi.fn(),
  createIssue: vi.fn(),
  moveIssue: vi.fn(),
  refreshReviews: vi.fn(),
}));
const rpc = vi.mocked(backendCall);
afterEach(() => vi.resetAllMocks());

describe('refresh the tasks in review', () => {
  it('shows one button, in the In review column only', () => {
    const html = renderToStaticMarkup(<TaskBoard project="demo" issues={[]} now={0} />);
    const label = 'Check the pull requests of the tasks in review now';
    expect(html.split(`aria-label="${label}"`)).toHaveLength(2);
    const review = html.slice(html.indexOf('id="column-in_review"'));
    expect(review.slice(0, review.indexOf('</section>'))).toContain(label);
  });

  it('runs one tending pass over every PR, as the backend does every few minutes', async () => {
    rpc.mockResolvedValue({ json: JSON.stringify({ tended: 'all' }) });
    expect(await tendPullRequestsNow('demo')).toEqual({ ok: true, value: undefined });
    expect(rpc).toHaveBeenCalledWith('TendPullRequests', { project: 'demo', id: '' });
  });

  it('reports a backend error instead of throwing', async () => {
    rpc.mockRejectedValue(new Error('backend down'));
    const result = await tendPullRequestsNow('demo');
    expect(result.ok).toBe(false);
  });
});
