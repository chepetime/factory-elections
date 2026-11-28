// The emergency stop. Pressing it turns the switch on first, so every start and model call is
// refused from that moment, then interrupts what already runs. The switch is one document in the
// data root, so it holds across restarts until a person resumes the factory.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { EMERGENCY_STOP_REFUSAL, EmergencyStopState, type EmergencyStopCounts } from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';
import { WORKSPACE_DIR } from '@factory/agents';
import type { BackendService } from './service.ts';

export type EmergencyStopDeps = {
  root: string;
  storage: Pick<DataStorage, 'readDocument' | 'writeDocument'>;
  /** Interrupts everything that runs now and counts it. Called after the switch is on. */
  interrupt: () => Promise<EmergencyStopCounts>;
  log?: (line: string) => void;
};

export class EmergencyStop {
  private state: EmergencyStopState = { on: false };
  private readonly deps: EmergencyStopDeps;
  constructor(deps: EmergencyStopDeps) {
    this.deps = deps;
  }

  private get path() {
    return join(this.deps.root, WORKSPACE_DIR, 'emergency-stop.json');
  }

  /** Reads the stored switch. Call once at start, before anything can run. */
  async load(): Promise<EmergencyStopState> {
    try {
      this.state = EmergencyStopState.parse(await this.deps.storage.readDocument(this.path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state = { on: false };
    }
    return this.get();
  }

  get(): EmergencyStopState {
    return structuredClone(this.state);
  }

  get on(): boolean {
    return this.state.on;
  }

  /** Why work may not start now; undefined while the factory runs. */
  refusal(): string | undefined {
    return this.state.on ? EMERGENCY_STOP_REFUSAL : undefined;
  }

  /**
   * Turns the switch on, then interrupts everything that runs. Pressing it again while it is on
   * interrupts again and keeps the original time.
   */
  async stop(): Promise<EmergencyStopState> {
    // No await before this line: from here on, every gate refuses.
    this.state = { on: true, since: this.state.since ?? new Date().toISOString() };
    await this.deps.storage.writeDocument(this.path, this.state);
    const stopped = await this.deps.interrupt();
    this.state = { ...this.state, stopped };
    await this.deps.storage.writeDocument(this.path, this.state);
    this.deps.log?.(
      `Emergency stop: interrupted ${stopped.runs} runs, ${stopped.reviews} reviews and ${stopped.executions} other agents.`,
    );
    return this.get();
  }

  /** Lets work start again. Nothing interrupted restarts by itself. */
  async resume(): Promise<EmergencyStopState> {
    this.state = { on: false };
    await this.deps.storage.writeDocument(this.path, this.state);
    this.deps.log?.('Emergency stop released: the factory runs again.');
    return this.get();
  }
}

/** The parts of the backend the stop interrupts. */
type Stoppable = Pick<
  BackendService,
  'root' | 'storage' | 'projects' | 'dispatcher' | 'executor' | 'executions' | 'profileChecks' | 'reviews'
>;

/** The backend's switch: it interrupts task runs, chats and feature steps, setup checks and reviews. */
export function emergencyStopFor(s: Stoppable): EmergencyStop {
  return new EmergencyStop({
    root: s.root,
    storage: s.storage,
    interrupt: () => interruptEverything(s),
    log: (line) => process.stderr.write(`${line}\n`),
  });
}

/**
 * Stops every task run (queued ones leave the queue, working ones get the abort signal), every
 * background execution (chat replies, feature steps), every setup check and every running review
 * turn. Children of a delegated call stop with their parent's grant.
 */
export async function interruptEverything(s: Stoppable): Promise<EmergencyStopCounts> {
  const runs = s.dispatcher.activeRuns();
  for (const run of runs) {
    s.dispatcher.stop(run);
    s.executor.abort(run);
  }
  const executions = s.executions.interruptAll();
  s.profileChecks.stopAll();
  let reviews = 0;
  for (const { name: project } of await s.projects.list().catch(() => [])) {
    const names = await readdir(join(s.root, project, 'reviews')).catch(() => [] as string[]);
    for (const number of names.filter((n) => /^\d+$/.test(n)).map(Number)) {
      const detail = await s.reviews.detail({ project, number }).catch(() => undefined);
      if (detail?.state !== 'running') continue;
      await s.reviews.stop({ project, number }).then(
        () => reviews++,
        () => undefined,
      );
    }
  }
  return { runs: runs.length, reviews, executions };
}
