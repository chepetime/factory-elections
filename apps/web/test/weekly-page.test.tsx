import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend-client';
import WeeklyPage from '@/app/projects/[project]/weekly/page';

vi.mock('@factory/backend-client', () => ({ backendCall: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
const rpc = vi.mocked(backendCall);
const params = () => Promise.resolve({ project: 'demo' });
const cost = {
  cost_usd: 2.5,
  unknown_cost_spans: 1,
  tokens: { input: 100, output: 30, cache_read: 25, cache_write: 4 },
};
const data = {
  from: '2026-01-01',
  to: '2026-01-08',
  total: cost,
  days: [{ ...cost, day: '2026-01-02' }],
  prs: { count: 2, median_cost_usd: 1.25, median_run_ms: 120000 },
  runs: { count: 4, failed: 1, failure_rate: 0.25, first_pass_rate: 0.75, climb_rate: 0.5 },
  reliability: { stalls: 1, repeat_loops: 2, failed_tool_calls: 1, tool_calls: 4 },
  call_grading: [
    {
      task_class: 'code/S',
      first_model: 'sonnet',
      runs: 4,
      first_pass: 3,
      climbed: 2,
      cost_usd: 2.5,
      grade: 'mixed',
    },
  ],
};
afterEach(() => vi.clearAllMocks());

it('requests project metrics and displays daily spend, PRs, reliability and grades', async () => {
  rpc.mockResolvedValue({ json: JSON.stringify(data) });
  const html = renderToStaticMarkup(await WeeklyPage({ params: params() }));
  expect(rpc).toHaveBeenCalledWith('GetMetrics', { project: 'demo', json: '{}' });
  expect(html).toContain('2026-01-02');
  expect(html).toContain('$2.50 (1 unknown)');
  expect(html).toContain('$1.25');
  expect(html).toContain('2.0 min');
  expect(html).toContain('75.0%');
  expect(html).toContain('25.0%');
  expect(html).toContain('code/S');
  expect(html).toContain('sonnet');
  expect(html).toContain('mixed');
});

it('shows empty data and backend failures distinctly', async () => {
  rpc.mockResolvedValueOnce({
    json: JSON.stringify({
      ...data,
      days: [],
      call_grading: [],
      prs: { count: 0 },
      runs: { count: 0, failed: 0 },
      reliability: { stalls: 0, repeat_loops: 0, failed_tool_calls: 0, tool_calls: 0 },
    }),
  });
  const empty = renderToStaticMarkup(await WeeklyPage({ params: params() }));
  expect(empty).toContain('No spans recorded');
  expect(empty).toContain('No graded calls');
  rpc.mockRejectedValueOnce(new Error('offline'));
  const error = renderToStaticMarkup(await WeeklyPage({ params: params() }));
  expect(error).toContain('Could not load metrics');
  expect(error).toContain('role="alert"');
});

it('rejects invalid projects before requesting metrics', async () => {
  await expect(WeeklyPage({ params: Promise.resolve({ project: '../bad' }) })).rejects.toThrow('not found');
  expect(rpc).not.toHaveBeenCalled();
});
