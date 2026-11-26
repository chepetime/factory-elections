// Engine health from :EngineHealthContract:. Any failure is "unavailable", never healthy.
import { z } from 'zod';

export const HEALTH_URL = 'http://127.0.0.1:4318/health';
export const HEALTH_TIMEOUT_MS = 2000;

const EngineHealth = z
  .object({
    engine: z.literal('running'),
    task_store: z.enum(['available', 'not_initialized', 'unavailable']),
    telemetry_database: z.enum(['not_configured', 'available', 'unavailable']),
    artifact_store: z.enum(['available', 'unavailable']).optional(),
    ledger: z
      .object({
        unknown_cost_spans: z.number().int().nonnegative(),
        missing_parent_links: z.number().int().nonnegative(),
        write_errors: z.number().int().nonnegative(),
      })
      .optional(),
    /** What startup recovery could not settle; `pending` until it ends. */
    recovery: z
      .object({
        state: z.enum(['pending', 'ok', 'degraded']),
        problems: z.number().int().nonnegative(),
      })
      .optional(),
    /** The agent session the backend was started from; its agents may run with capped permissions. */
    host_session: z.literal('claude-code').optional(),
    /** PR review turns running in the backend now. */
    reviews_running: z.number().int().nonnegative().optional(),
    integrations: z.array(z.never()).max(0),
  })
  .strict();
export type EngineHealth = z.infer<typeof EngineHealth>;

export type HealthState = { status: 'ok'; health: EngineHealth } | { status: 'unavailable' };

export interface HealthSeam {
  fetch: (url: string, init: { signal: AbortSignal; cache: 'no-store' }) => Promise<Response>;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: never) => void;
}

const defaultSeam: HealthSeam = {
  fetch: (url, init) => fetch(url, init),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export async function readEngineHealth(seam: HealthSeam = defaultSeam): Promise<HealthState> {
  const controller = new AbortController();
  let timer: unknown;
  const timeout = new Promise<'timeout'>((done) => {
    timer = seam.setTimeout(() => {
      controller.abort();
      done('timeout');
    }, HEALTH_TIMEOUT_MS);
  });
  try {
    const request = (async () => {
      const response = await seam.fetch(
        process.env.FACTORY_HEALTH_PORT
          ? `http://127.0.0.1:${process.env.FACTORY_HEALTH_PORT}/health`
          : HEALTH_URL,
        { signal: controller.signal, cache: 'no-store' },
      );
      if (!response.ok) return undefined;
      return EngineHealth.safeParse(await response.json());
    })();
    const result = await Promise.race([request, timeout]);
    if (result === 'timeout' || !result?.success) return { status: 'unavailable' };
    return { status: 'ok', health: result.data };
  } catch {
    return { status: 'unavailable' };
  } finally {
    seam.clearTimeout(timer as never);
  }
}
