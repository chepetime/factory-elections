import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend-client';
import TracePage from '@/app/projects/[project]/tasks/[id]/trace/page';

vi.mock('@factory/backend-client', () => ({ backendCall: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
const rpc = vi.mocked(backendCall);
const id = '11111111-2222-4333-8444-555555555555';
const params = () => Promise.resolve({ project: 'demo', id });
const span = (name: string, extra: Record<string, unknown> = {}) => ({
  trace_id: 'trace',
  span_id: name,
  type: 'model',
  name,
  project: 'demo',
  started_at: '2026-01-01T00:00:00Z',
  ended_at: '2026-01-01T00:00:01Z',
  outcome: 'completed',
  ...extra,
});
const total = {
  cost_usd: 1.25,
  unknown_cost_spans: 1,
  tokens: { input: 120, output: 30, cache_read: 0, cache_write: 0 },
};
afterEach(() => vi.clearAllMocks());

it('requests a task trace and renders nested spans with subtree totals and unknowns', async () => {
  rpc.mockResolvedValue({
    json: JSON.stringify({
      spans: 2,
      roots: [
        {
          span: span('Run', { type: 'run', duration_ms: 1000 }),
          total,
          children: [
            {
              span: span('Coder', { cost_usd: null, tokens: { input: 120, output: 30 } }),
              total,
              children: [],
            },
          ],
        },
      ],
    }),
  });
  const html = renderToStaticMarkup(await TracePage({ params: params() }));
  expect(rpc).toHaveBeenCalledWith('GetTrace', { project: 'demo', json: JSON.stringify({ task_id: id }) });
  expect(html).toContain('Run');
  expect(html).toContain('Coder');
  expect(html).toContain('1.00 s');
  expect(html).toContain('120 input / 30 output tokens');
  expect(html).toContain('$1.2500 (1 unknown)');
  expect(html).toContain('Unknown cost');
  expect(html).toContain('1 unknown');
});

it('shows empty and failed states', async () => {
  rpc.mockResolvedValueOnce({ json: JSON.stringify({ spans: 0, roots: [] }) });
  expect(renderToStaticMarkup(await TracePage({ params: params() }))).toContain('No spans recorded');
  rpc.mockRejectedValueOnce(new Error('offline'));
  const html = renderToStaticMarkup(await TracePage({ params: params() }));
  expect(html).toContain('Could not load the trace');
  expect(html).toContain('role="alert"');
});

it('rejects an invalid task id without calling the backend', async () => {
  await expect(TracePage({ params: Promise.resolve({ project: 'demo', id: '../x' }) })).rejects.toThrow(
    'not found',
  );
  expect(rpc).not.toHaveBeenCalled();
});
