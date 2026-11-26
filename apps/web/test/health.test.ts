import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_TIMEOUT_MS, readEngineHealth, type HealthSeam } from '@/lib/health';

const valid = (task_store: string) => ({
  engine: 'running',
  task_store,
  telemetry_database: 'not_configured',
  integrations: [],
});

function seam(fetchImpl: HealthSeam['fetch']): HealthSeam {
  return {
    fetch: fetchImpl,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h),
  };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

const read = (fetchImpl: HealthSeam['fetch']) => readEngineHealth(seam(fetchImpl));
const health = async (fetchImpl: HealthSeam['fetch']) => {
  const state = await read(fetchImpl);
  if (state.status !== 'ok') throw new Error('expected a healthy engine');
  return state.health;
};

afterEach(() => vi.useRealTimers());

// Settings, System status shows these fields (lib/status.ts); this tests the reading of them.
describe('engine health', () => {
  it.each(['available', 'unavailable'] as const)(
    'reads configured Postgres and artifact storage as %s',
    async (state) => {
      const body = { ...valid('available'), telemetry_database: state, artifact_store: state };
      expect(await health(() => json(body))).toMatchObject({
        telemetry_database: state,
        artifact_store: state,
      });
    },
  );
  it.each(['available', 'not_initialized', 'unavailable'])('reads task store %s', async (value) => {
    expect((await health(() => json(valid(value)))).task_store).toBe(value);
  });

  it.each([
    { state: 'ok', problems: 0 },
    { state: 'degraded', problems: 2 },
  ])('reads recovery %o, not as an unavailable engine', async (recovery) => {
    expect((await health(() => json({ ...valid('available'), recovery }))).recovery).toEqual(recovery);
  });

  it.each([
    ['non-success', () => json(valid('available'), 500)],
    ['malformed', () => Promise.resolve(new Response('not json', { status: 200 }))],
    ['invalid', () => json({ ...valid('available'), engine: 'stopped' })],
    ['extra integration', () => json({ ...valid('available'), integrations: ['x'] })],
    ['failed', () => Promise.reject(new Error('ECONNREFUSED'))],
  ] as const)('reads a %s response as unavailable', async (_name, impl) => {
    expect((await read(impl as HealthSeam['fetch'])).status).toBe('unavailable');
  });

  it('fetches separately for each request and shows changed data', async () => {
    const calls: string[] = [];
    const answers = ['available', 'unavailable'];
    const impl: HealthSeam['fetch'] = (url, init) => {
      calls.push(url);
      expect(init.cache).toBe('no-store');
      return json(valid(answers[calls.length - 1]!));
    };
    expect((await health(impl)).task_store).toBe('available');
    expect((await health(impl)).task_store).toBe('unavailable');
    expect(calls).toEqual(['http://127.0.0.1:4318/health', 'http://127.0.0.1:4318/health']);
  });

  it('times out at two seconds on a controlled clock', async () => {
    vi.useFakeTimers();
    const never: HealthSeam['fetch'] = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    let settled: string | undefined;
    const pending = readEngineHealth(seam(never)).then((s) => (settled = s.status));
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe('unavailable');
  });

  it('accepts a response just inside the deadline', async () => {
    vi.useFakeTimers();
    const slow: HealthSeam['fetch'] = () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(new Response(JSON.stringify(valid('available')))), HEALTH_TIMEOUT_MS - 1),
      );
    const pending = readEngineHealth(seam(slow));
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS - 1);
    expect((await pending).status).toBe('ok');
  });
});
