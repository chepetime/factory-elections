import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineHealthView } from '@/components/engine-health-panel';
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

async function render(fetchImpl: HealthSeam['fetch']) {
  return renderToStaticMarkup(<EngineHealthView state={await readEngineHealth(seam(fetchImpl))} />);
}

afterEach(() => vi.useRealTimers());

describe('engine health panel', () => {
  it.each([
    ['available', 'Available'],
    ['not_initialized', 'Not initialized'],
    ['unavailable', 'Unavailable'],
  ])('shows task store %s', async (value, label) => {
    const html = await render(() => json(valid(value)));
    expect(html).toContain('Engine health');
    expect(html).toContain('Running');
    expect(html).toContain(label);
    expect(html).toContain('Not configured');
    expect(html).toContain('No integrations configured');
  });

  it.each([
    ['non-success', () => json(valid('available'), 500)],
    ['malformed', () => Promise.resolve(new Response('not json', { status: 200 }))],
    ['invalid', () => json({ ...valid('available'), engine: 'stopped' })],
    ['extra integration', () => json({ ...valid('available'), integrations: ['x'] })],
    ['failed', () => Promise.reject(new Error('ECONNREFUSED'))],
  ] as const)('shows unavailable for a %s response', async (_name, impl) => {
    const html = await render(impl as HealthSeam['fetch']);
    expect(html).toContain('Engine unavailable');
    expect(html).not.toContain('Running');
  });

  it('fetches separately for each request and shows changed data', async () => {
    const calls: string[] = [];
    const answers = ['available', 'unavailable'];
    const impl: HealthSeam['fetch'] = (url, init) => {
      calls.push(url);
      expect(init.cache).toBe('no-store');
      return json(valid(answers[calls.length - 1]!));
    };
    expect(await render(impl)).toContain('Available');
    expect(await render(impl)).toContain('Unavailable');
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
