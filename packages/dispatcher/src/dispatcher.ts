// The task run queue: worker permits, the run's own agent, a pool slot, stop before start, and
// shutdown. It knows nothing about tasks, git or models; the backend passes each job's work in.
import { Cause, Effect, Exit, Fiber, Semaphore } from 'effect';
import type { QueueWait } from '@factory/core';
import type { AgentPool, Release } from './agent-pool.ts';

export interface Job {
  /** `project/task id`. One task may have more than one turn queued. */
  task: string;
  /** The run id. Stops and completions are per run. */
  run: string;
  /** The agent whose turns limit this job, read when the job reaches a worker; undefined for none. */
  agent(): Promise<{ name: string; limit: number } | undefined>;
  /**
   * The work, once the job holds a worker, its agent and a pool slot. Call `release` as soon as the
   * agent is done, so the next job can start while this one writes its records.
   */
  work(release: Release): Promise<void>;
  /** Once, when a person stopped the job before it started: the work never runs. */
  cancelled(): Promise<void>;
  /** Last, however the job ended (e.g. free the task lock). */
  settle(): Promise<void>;
}

export interface DispatcherOptions {
  /** Jobs that may work at once. */
  workers: number;
  pool: AgentPool;
  /** Jobs that may be accepted and not yet settled. */
  maxQueued?: number;
  log?: (line: string) => void;
}

export class Dispatcher {
  private readonly worker: Semaphore.Semaphore;
  private readonly pool: AgentPool;
  private readonly maxQueued: number;
  private readonly log: (line: string) => void;
  private open = true;
  private reservations = 0;
  /** Per task: jobs accepted and not settled. */
  private readonly scheduled = new Map<string, number>();
  /** Per task: jobs that hold their slots and work. */
  private readonly working = new Map<string, number>();
  /** Tasks with a job blocked by its own agent's limit. */
  private readonly agentWaits = new Set<string>();
  private readonly stops = new Set<string>();
  /** Per run, while the job waits for a worker: drops it from that queue. False once it started. */
  private readonly unstarted = new Map<string, () => boolean>();
  private readonly completions = new Map<string, Promise<void>>();

  constructor(options: DispatcherOptions) {
    this.worker = Effect.runSync(Semaphore.make(options.workers));
    this.pool = options.pool;
    this.maxQueued = options.maxQueued ?? 32;
    this.log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
  }

  get accepting(): boolean {
    return this.open;
  }

  /**
   * Holds a queue place while the caller prepares a job (takes its lock, writes its record). Pass
   * it to `schedule`, or call it to give the place back. Undefined when closed or full.
   */
  reserve(): Release | undefined {
    if (!this.open || this.reservations >= this.maxQueued) return undefined;
    this.reservations++;
    let released = false;
    return () => {
      if (!released) this.reservations--;
      released = true;
    };
  }

  /** Queues a job. It takes over the reservation, which it gives back when the job settles. */
  schedule(job: Job, reservation: Release): void {
    this.scheduled.set(job.task, (this.scheduled.get(job.task) ?? 0) + 1);
    // `entered` and `abandoned` change with no await between check and set, so a stop either
    // drops the job before it reaches a worker or leaves it to `run`, never both.
    let entered = false;
    let abandoned = false;
    const effect = Effect.suspend(() => {
      if (abandoned) return Effect.void;
      entered = true;
      this.unstarted.delete(job.run);
      return Effect.tryPromise({ try: () => this.run(job), catch: (error) => error });
    }).pipe(
      this.worker.withPermits(1),
      Effect.ensuring(
        Effect.promise(async () => {
          try {
            this.unstarted.delete(job.run);
            if (abandoned) await this.cancel(job);
            await job.settle();
          } finally {
            reservation();
            this.completions.delete(job.run);
            this.stops.delete(job.run);
            this.count(this.scheduled, job.task, -1);
          }
        }),
      ),
    );
    const fiber = Effect.runFork(effect);
    this.unstarted.set(job.run, () => {
      if (entered) return false;
      abandoned = true;
      // Safe: the fiber only waits for a worker permit, and the job has not started.
      Effect.runFork(Fiber.interrupt(fiber));
      return true;
    });
    this.completions.set(
      job.run,
      Effect.runPromise(Fiber.await(fiber)).then((exit) => {
        if (exit._tag === 'Failure' && !(abandoned && Exit.hasInterrupts(exit)))
          this.log(`Run ${job.run} could not finalize: ${Cause.pretty(exit.cause)}`);
      }),
    );
  }

  /** Why a job queued for the task has not started; undefined when none waits. */
  waiting(task: string): QueueWait | undefined {
    if (!this.scheduled.has(task) || this.working.has(task)) return undefined;
    return this.agentWaits.has(task) ? 'agent' : 'slot';
  }

  /** Whether a job for the task is queued or working. */
  scheduledFor(task: string): boolean {
    return this.scheduled.has(task);
  }

  /** Whether the run's job is accepted and not settled. */
  active(run: string): boolean {
    return this.completions.has(run);
  }

  /** Settles when the run's job settled; undefined when it is not active. */
  completion(run: string): Promise<void> | undefined {
    return this.completions.get(run);
  }

  /** The ids of every run accepted and not settled, queued or working. */
  activeRuns(): string[] {
    return [...this.completions.keys()];
  }

  /** Every active job's completion. */
  pending(): Promise<void>[] {
    return [...this.completions.values()];
  }

  /** Whether a person asked to stop the run. A job that already works reads this for its outcome. */
  stopRequested(run: string): boolean {
    return this.stops.has(run);
  }

  /**
   * Asks the run's job to stop. One that has not started leaves the queue now and never runs; one
   * that works must stop its own work (the dispatcher cannot abort it).
   */
  stop(run: string): void {
    if (!this.completions.has(run)) return;
    this.stops.add(run);
    this.unstarted.get(run)?.();
    this.pool.wake();
  }

  /** No new jobs. Jobs that have not started stay unstarted, so the caller keeps them queued. */
  close(): void {
    this.open = false;
    this.pool.close();
  }

  /** Waits until every accepted job settled and no caller holds a reservation. */
  async drained(): Promise<void> {
    while (this.reservations > 0) {
      const pending = this.pending();
      if (pending.length) await Promise.all(pending);
      else await new Promise((done) => setTimeout(done, 10));
    }
  }

  private async run(job: Job): Promise<void> {
    const stopped = () => this.stops.has(job.run);
    const agent = await job.agent();
    // Its own agent first: a job that waits for a busy agent must not hold a slot others could use.
    const own = agent
      ? await this.pool.acquireAgent(agent.name, agent.limit, stopped, (on) =>
          on ? this.agentWaits.add(job.task) : this.agentWaits.delete(job.task),
        )
      : () => {};
    if (!own) {
      if (stopped()) await this.cancel(job);
      return;
    }
    const pooled = await this.pool.acquire(stopped);
    if (!pooled || stopped()) {
      pooled?.();
      own();
      // Closed: the job stays unstarted. Stopped: it never runs.
      if (stopped()) await this.cancel(job);
      return;
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.count(this.working, job.task, -1);
      pooled();
      own();
    };
    this.count(this.working, job.task, 1);
    try {
      await job.work(release);
    } finally {
      release();
    }
  }

  private async cancel(job: Job): Promise<void> {
    this.stops.delete(job.run);
    await job
      .cancelled()
      .catch((error) => this.log(`Run ${job.run} could not record its stop: ${String(error)}`));
  }

  private count(map: Map<string, number>, key: string, by: 1 | -1): void {
    const next = (map.get(key) ?? 0) + by;
    if (next > 0) map.set(key, next);
    else map.delete(key);
  }
}
