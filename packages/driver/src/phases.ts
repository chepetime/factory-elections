// Phase timing for a run: measurement only. A sink failure never changes the run.
import type { DriverDeps, PhaseSpan } from './ports.ts';

/** Reports one finished phase to the optional sink on the driver's deps. */
export function emitPhase(
  deps: DriverDeps,
  task: { project: string; id: string },
  type: PhaseSpan['type'],
  started: number,
  outcome: PhaseSpan['outcome'],
  attributes?: PhaseSpan['attributes'],
): void {
  if (!deps.phase) return;
  const ended = Date.now();
  try {
    deps.phase(task, {
      type,
      name: type,
      started_at: new Date(started).toISOString(),
      ended_at: new Date(ended).toISOString(),
      duration_ms: Math.max(0, ended - started),
      outcome,
      ...(attributes ? { attributes } : {}),
    });
  } catch {
    // Measurement must never break a run.
  }
}
