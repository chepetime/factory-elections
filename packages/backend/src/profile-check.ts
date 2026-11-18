// "Check setup" for a project: the driver's profile check, run in the background with live
// output, so login, install and check problems show up before any paid run.
import { join } from 'node:path';
import type { DataStorage } from '@factory/adapters-data';
import type { Driver, ProfileCheckStep } from '@factory/driver';

export interface ProfileCheckState {
  running: boolean;
  started_at?: string;
  finished_at?: string;
  passed?: boolean;
  steps: ProfileCheckStep[];
  /** The tail of the check's output: live while it runs, kept with the result. */
  log?: string;
  error?: string;
}

const LOG_TAIL = 8000;

interface Deps {
  root: string;
  storage: Pick<DataStorage, 'readDocument' | 'writeDocument'>;
  repo: (project: string) => Promise<string>;
  driver: (log: (line: string) => void, signal: AbortSignal) => Driver;
}

export class ProfileChecks {
  private readonly live = new Map<string, { state: ProfileCheckState; controller: AbortController }>();
  private readonly deps: Deps;
  constructor(deps: Deps) {
    this.deps = deps;
  }
  private path(project: string): string {
    return join(this.deps.root, project, 'profile-check.json');
  }

  /** Starts a check unless one is running for the project; returns its state. */
  async start(project: string): Promise<ProfileCheckState> {
    const current = this.live.get(project);
    if (current) return current.state;
    const repo = await this.deps.repo(project);
    const controller = new AbortController();
    const state: ProfileCheckState = {
      running: true,
      started_at: new Date().toISOString(),
      steps: [],
      log: '',
    };
    this.live.set(project, { state, controller });
    const log = (line: string) => {
      const next = `${state.log ?? ''}${line}\n`;
      state.log = next.length > LOG_TAIL ? next.slice(-LOG_TAIL) : next;
    };
    void (async () => {
      try {
        const result = await this.deps.driver(log, controller.signal).checkProfile(project, repo);
        state.passed = result.passed;
        state.steps = result.steps;
      } catch (error) {
        state.passed = false;
        state.error = error instanceof Error ? error.message : String(error);
      } finally {
        state.running = false;
        state.finished_at = new Date().toISOString();
        await this.deps.storage.writeDocument(this.path(project), state).catch(() => undefined);
        this.live.delete(project);
      }
    })();
    return state;
  }

  /** The running check, or the last saved result, or an empty state. */
  async get(project: string): Promise<ProfileCheckState> {
    const current = this.live.get(project);
    if (current) return current.state;
    return (
      ((await this.deps.storage.readDocument(this.path(project)).catch(() => undefined)) as
        ProfileCheckState | undefined) ?? { running: false, steps: [] }
    );
  }

  /** Stops every running check, for shutdown. */
  stopAll(): void {
    for (const { controller } of this.live.values()) controller.abort();
  }
}
