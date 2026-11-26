import { afterEach, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend-client';
import { readEngineHealth } from '@/lib/health';
import { systemStatus } from '@/lib/status';

vi.mock('@factory/backend-client', () => ({ backendCall: vi.fn() }));
vi.mock('@/lib/health', () => ({ readEngineHealth: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const health = (extra: object) => ({
  status: 'ok' as const,
  health: {
    engine: 'running' as const,
    task_store: 'available' as const,
    telemetry_database: 'not_configured' as const,
    integrations: [],
    ...extra,
  },
});

it('warns when the backend was started from a Claude Code session, with how to fix it', async () => {
  vi.mocked(backendCall).mockResolvedValue({
    json: JSON.stringify({ checked_at: 'x', data_root: '/d', environment: [], profiles: [] }),
  });
  vi.mocked(readEngineHealth).mockResolvedValue(health({ host_session: 'claude-code' }));
  const host = (await systemStatus()).checks.find((c) => c.id === 'engine-host');
  expect(host).toMatchObject({ status: 'warn', detail: 'A Claude Code session' });
  expect(host?.fix).toMatch(/start it from a terminal/);

  vi.mocked(readEngineHealth).mockResolvedValue(health({}));
  expect((await systemStatus()).checks.some((c) => c.id === 'engine-host')).toBe(false);
});
