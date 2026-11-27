// The memory page lists what the factory remembers, shows the sessions behind each fact, and removes a
// wrong fact through the backend's ForgetFact (a soft drop, so a review cannot propose it again).
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend-client';
import { forgetFactAction } from '@/app/memory-actions';
import MemoryPage from '@/app/projects/[project]/memory/page';

vi.mock('@factory/backend-client', () => ({ backendCall: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/components/local-time', () => ({ LocalTime: ({ iso }: { iso?: string }) => <time>{iso}</time> }));
const rpc = vi.mocked(backendCall);
afterEach(() => vi.clearAllMocks());

const fact = (over: Record<string, unknown>) => ({
  id: 'f1',
  text: 'Run `pnpm build` before tests.',
  kind: 'build',
  sessions: ['run1:coder:1', 'run1:coder:2', 'run2:coder:1'],
  status: 'active',
  created_at: '2026-11-20T10:00:00.000Z',
  updated_at: '2026-11-25T10:00:00.000Z',
  ...over,
});
const snapshot = (facts: unknown[], over: Record<string, unknown> = {}) => ({
  facts,
  pruned_tools: [],
  sessions: 9,
  pending: 1,
  review_cost_usd: 0.0123,
  ...over,
});
const render = async (show?: string) =>
  renderToStaticMarkup(
    await MemoryPage({
      params: Promise.resolve({ project: 'demo' }),
      searchParams: Promise.resolve({ show }),
    }),
  );

it('the memory page lists active and candidate facts with confirmations', async () => {
  rpc.mockResolvedValue({
    json: JSON.stringify(
      snapshot(
        [
          fact({}),
          fact({
            id: 'f2',
            text: 'Use pnpm, not npm.',
            kind: 'command',
            status: 'candidate',
            sessions: ['a', 'b'],
          }),
          fact({ id: 'f3', text: 'Old fact.', status: 'dropped', dropped_reason: 'removed by the user' }),
        ],
        { pruned_tools: ['CronCreate'] },
      ),
    ),
  });
  const html = await render();
  expect(rpc).toHaveBeenCalledWith('GetMemory', { project: 'demo', id: '' });
  expect(html).toMatch(/aria-label="Active".*Run `pnpm build` before tests\./s);
  expect(html).toMatch(/aria-label="Candidates".*Use pnpm, not npm\..*2 of 3 confirmations/s);
  expect(html).not.toContain('Old fact.');
  expect(html).toContain('Show removed facts (1)');
  expect(html).toContain('CronCreate');
  expect(html).toContain('Restore tools');
  expect(html).toContain('$0.01');
});

it('Remove drops the fact and shows it under Removed', async () => {
  rpc.mockResolvedValueOnce({ text: 'forgotten' });
  expect(await forgetFactAction('demo', 'f1')).toEqual({});
  expect(rpc).toHaveBeenCalledWith('ForgetFact', { project: 'demo', id: 'f1' });

  rpc.mockResolvedValue({
    json: JSON.stringify(snapshot([fact({ status: 'dropped', dropped_reason: 'removed by the user' })])),
  });
  expect(await render()).not.toContain('Run `pnpm build` before tests.');
  const html = await render('removed');
  expect(html).toMatch(/aria-label="Removed".*Run `pnpm build` before tests\..*removed by the user/s);
  expect(html).not.toContain('>Remove</button>');
  expect(html).toContain('Hide removed facts (1)');
});

it('shows the RPC error when memory cannot be read or a fact cannot be removed', async () => {
  rpc.mockRejectedValueOnce(new Error('backend down'));
  expect(await render()).toContain('Memory unavailable: backend down');
  rpc.mockRejectedValueOnce(new Error('no fact f9'));
  expect(await forgetFactAction('demo', 'f9')).toEqual({ error: 'no fact f9' });
  expect(await forgetFactAction('../x', 'f9')).toEqual({ error: 'Invalid project or fact.' });
});
