// One limit for every agent this backend runs: task runs, chats, delegated children, feature steps
// and tending. Reviews run outside the pool and count through `external`.

/** Agents that may run at once on the machine's one Claude sign-in: reviews plus task runs. */
export const MAX_AGENTS = Number(process.env.FACTORY_MAX_AGENTS ?? 6);

/** Frees what it was given. Calling it again does nothing. */
export type Release = () => void;

export interface AgentPoolOptions {
  /** Agents that may run at once, inside and outside the pool. */
  max: number;
  /** How often a waiter checks again when nothing wakes it, in ms. */
  pollMs?: number;
  /** Agents running outside the pool, e.g. PR reviews. It may read storage, so it is cached. */
  external?: () => Promise<number>;
  /** How long one `external` count serves every waiter, in ms. */
  externalTtlMs?: number;
}

export class AgentPool {
  readonly max: number;
  private readonly pollMs: number;
  private readonly externalTtlMs: number;
  private readonly readExternal: () => Promise<number>;
  private external?: { at: number; count: Promise<number> };
  private held = 0;
  private readonly agents = new Map<string, number>();
  private readonly wakers = new Set<() => void>();
  private closed = false;

  constructor(options: AgentPoolOptions) {
    this.max = options.max;
    this.pollMs = options.pollMs ?? 2000;
    this.externalTtlMs = options.externalTtlMs ?? 1000;
    this.readExternal = options.external ?? (async () => 0);
  }

  /** Slots this pool holds now. */
  inUse(): number {
    return this.held;
  }

  /** Takes a slot now if one is free; undefined when none is, or the pool is closed. */
  async tryAcquire(): Promise<Release | undefined> {
    if (this.closed) return undefined;
    const external = await this.externalCount();
    // Count and take with no await between them, so two callers never take the same slot.
    if (this.closed || this.held + external >= this.max) return undefined;
    this.held++;
    return this.releaser(() => this.held--);
  }

  /** Waits for a slot. Undefined when `stopped` turns true or the pool closes first. */
  async acquire(stopped: () => boolean = () => false): Promise<Release | undefined> {
    for (;;) {
      if (this.closed || stopped()) return undefined;
      const release = await this.tryAcquire();
      if (release) return release;
      if (this.closed || stopped()) return undefined;
      await this.nap();
    }
  }

  /**
   * Waits until the named agent runs fewer than `limit` turns, then takes one of its turns. Calls
   * `waiting(true)` while it waits and `waiting(false)` when the wait ends, however it ends.
   */
  async acquireAgent(
    name: string,
    limit: number,
    stopped: () => boolean = () => false,
    waiting: (on: boolean) => void = () => {},
  ): Promise<Release | undefined> {
    try {
      for (;;) {
        if (this.closed || stopped()) return undefined;
        const used = this.agents.get(name) ?? 0;
        if (used < limit) {
          this.agents.set(name, used + 1);
          return this.releaser(() => {
            const left = (this.agents.get(name) ?? 1) - 1;
            if (left > 0) this.agents.set(name, left);
            else this.agents.delete(name);
          });
        }
        waiting(true);
        await this.nap();
      }
    } finally {
      waiting(false);
    }
  }

  /** Every waiter checks again now. A stop or a freed slot outside the pool calls this. */
  wake(): void {
    this.external = undefined;
    for (const waker of this.wakers) waker();
  }

  /** No new slots from now on; waiters return undefined. Slots already held stay valid. */
  close(): void {
    this.closed = true;
    this.wake();
  }

  private releaser(free: () => void): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      free();
      this.wake();
    };
  }

  private externalCount(): Promise<number> {
    const now = Date.now();
    if (!this.external || now - this.external.at > this.externalTtlMs)
      this.external = { at: now, count: this.readExternal().catch(() => 0) };
    return this.external.count;
  }

  private nap(): Promise<void> {
    return new Promise((done) => {
      const waker = () => {
        clearTimeout(timer);
        this.wakers.delete(waker);
        done();
      };
      const timer = setTimeout(waker, this.pollMs);
      this.wakers.add(waker);
    });
  }
}
