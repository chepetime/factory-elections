// Background executions other than task runs (feature steps first): one lifecycle for capacity,
// interruption, shutdown and finalization. Each caller keeps its own domain transitions; this
// class decides when work may start, stops it, and always finalizes it once.
import type { ExecutionOutcome } from '@factory/core';
import type { AgentPool, Release } from './agent-pool.ts';

export interface ExecutionSpec {
  /** One execution per key at a time, e.g. `project/feature id`. */
  key: string;
  /** What it does, for observers, e.g. `write-spec`. */
  action: string;
  /** Records that the work was accepted. A failure here refuses the execution and frees its slot. */
  accept(): Promise<void>;
  /** The work. It must pass `signal` to its model calls and stop when it aborts. */
  work(signal: AbortSignal): Promise<void>;
  /** Called exactly once, after `work` ends or `accept` fails, with how it ended. */
  finalize(result: { outcome: ExecutionOutcome; error?: string }): Promise<void>;
}

export interface ExecutionView {
  action: string;
  started_at: string;
  stopping: boolean;
  /** Why it is stopping: a person cancelled it, or shutdown interrupted it. */
  stop_reason?: 'cancelled' | 'interrupted';
}

interface Live {
  action: string;
  started_at: string;
  controller: AbortController;
  /** Why it was aborted, if it was. */
  reason?: 'cancelled' | 'interrupted';
  done: Promise<void>;
}

export class ExecutionRefused extends Error {}

export class Executions {
  private readonly pool: AgentPool;
  private readonly log: (line: string) => void;
  private readonly live = new Map<string, Live>();
  private open = true;

  constructor(options: { pool: AgentPool; log?: (line: string) => void }) {
    this.pool = options.pool;
    this.log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
  }

  /**
   * Takes a pool slot now and starts the work in the background. Throws ExecutionRefused when the
   * key already runs, no slot is free, or shutdown began; it throws accept()'s error after
   * finalizing as failed. Resolves once the work is accepted, not when it ends.
   */
  async submit(spec: ExecutionSpec): Promise<void> {
    if (!this.open) throw new ExecutionRefused('The backend is shutting down');
    if (this.live.has(spec.key)) throw new ExecutionRefused(`${spec.key} is already working`);
    const release = await this.pool.tryAcquire();
    if (!release) throw new ExecutionRefused('Every agent slot is in use; try again when one finishes');
    // Checked again after the await: a second submit or a shutdown may have come in meanwhile.
    if (!this.open || this.live.has(spec.key)) {
      release();
      throw new ExecutionRefused(
        this.open ? `${spec.key} is already working` : 'The backend is shutting down',
      );
    }
    const controller = new AbortController();
    let settle!: () => void;
    const live: Live = {
      action: spec.action,
      started_at: new Date().toISOString(),
      controller,
      done: new Promise<void>((done) => (settle = done)),
    };
    this.live.set(spec.key, live);
    try {
      await spec.accept();
    } catch (error) {
      await this.end(spec, live, release, settle, { outcome: 'failed', error: message(error) });
      throw error;
    }
    void spec
      .work(controller.signal)
      .then(
        () => (live.reason ? { outcome: live.reason } : { outcome: 'completed' as const }),
        (error: unknown) =>
          live.reason ? { outcome: live.reason } : { outcome: 'failed' as const, error: message(error) },
      )
      .then((result) => this.end(spec, live, release, settle, result));
  }

  /** What runs under the key now; undefined when nothing does. */
  observe(key: string): ExecutionView | undefined {
    const live = this.live.get(key);
    return (
      live && {
        action: live.action,
        started_at: live.started_at,
        stopping: !!live.reason,
        ...(live.reason ? { stop_reason: live.reason } : {}),
      }
    );
  }

  /** The abort signal of the work under the key, for its model calls. */
  signal(key: string): AbortSignal | undefined {
    return this.live.get(key)?.controller.signal;
  }

  /** Stops the work under the key; it finalizes as `cancelled`. False when nothing runs. */
  interrupt(key: string, reason: 'cancelled' | 'interrupted' = 'cancelled'): boolean {
    const live = this.live.get(key);
    if (!live) return false;
    live.reason ??= reason;
    live.controller.abort();
    return true;
  }

  /** Stops every execution that runs now; each finalizes as `cancelled`. Returns how many. */
  interruptAll(): number {
    const keys = [...this.live.keys()];
    for (const key of keys) this.interrupt(key);
    return keys.length;
  }

  /** Resolves when the work under the key has finalized. */
  settled(key: string): Promise<void> {
    return this.live.get(key)?.done ?? Promise.resolve();
  }

  /**
   * Refuses new work, lets running work finish for `graceMs`, then interrupts it, and waits until
   * every execution has finalized.
   */
  async drain(graceMs: number): Promise<void> {
    this.open = false;
    const timer = setTimeout(() => {
      for (const key of this.live.keys()) this.interrupt(key, 'interrupted');
    }, graceMs);
    try {
      while (this.live.size) await Promise.all([...this.live.values()].map((l) => l.done));
    } finally {
      clearTimeout(timer);
    }
  }

  private async end(
    spec: ExecutionSpec,
    live: Live,
    release: Release,
    settle: () => void,
    result: { outcome: ExecutionOutcome; error?: string },
  ): Promise<void> {
    // The slot goes back before finalize writes, as for task runs.
    release();
    try {
      await spec.finalize(result);
    } catch (error) {
      this.log(`Execution ${spec.key} could not finalize: ${message(error)}`);
    } finally {
      this.live.delete(spec.key);
      settle();
    }
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
