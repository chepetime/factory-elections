import { expect, it } from 'vitest';
import { modelUsage } from '@/lib/system';

it('groups model calls by provider and model, busiest first, with failures, tokens and cost', () => {
  const call = (model: string, extra: Partial<Parameters<typeof modelUsage>[0][number]> = {}) => ({
    provider: 'claude',
    model,
    outcome: 'completed' as const,
    cost_usd: 0.5,
    tokens: { input: 100, output: 10 },
    ...extra,
  });
  const rows = modelUsage([
    call('sonnet'),
    call('opus'),
    call('opus', { outcome: 'failed', cost_usd: null }),
    call('gpt', { provider: 'codex', cost_usd: null, tokens: undefined }),
  ]);
  expect(rows.map((r) => [r.provider, r.model, r.calls, r.failed])).toEqual([
    ['claude', 'opus', 2, 1],
    ['codex', 'gpt', 1, 0],
    ['claude', 'sonnet', 1, 0],
  ]);
  expect(rows[0]).toMatchObject({ cost: 0.5, input: 200, output: 20 });
  // No call reported a cost: say so rather than show $0.00.
  expect(rows[1]).toMatchObject({ cost: null, input: 0 });
});
