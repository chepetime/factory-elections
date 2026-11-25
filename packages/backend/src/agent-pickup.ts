// Starts Todo tasks assigned to agents when those agents have free slots. A start that fails (an
// unapproved profile, a dirty repository) leaves one note on the task and waits before trying again.
import { pickupPlan, type AgentProfile, type PickupCandidate, type TaskRecord } from '@factory/core';
import type { IssueService } from './issues.ts';

/** How long a task that could not start waits before the next try. */
export const PICKUP_RETRY_MS = 10 * 60_000;
export const PICKUP_INTERVAL_MS = 20_000;

/** Stages in which an agent run occupies its agent. A run waiting for a person does not. */
const WORKING = new Set(['queued', 'classified', 'coding', 'reviewing']);

export type PickupDeps = {
  agents: () => Promise<AgentProfile[]>;
  projects: () => Promise<{ name: string }[]>;
  issues: Pick<IssueService, 'list' | 'move' | 'note'>;
  tasks: (project: string) => Promise<TaskRecord[]>;
  accepting: () => boolean;
  now?: () => number;
  log?: (line: string) => void;
};

export class AgentPickup {
  private readonly deps: PickupDeps;
  private readonly retryAt = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private again = false;
  constructor(deps: PickupDeps) {
    this.deps = deps;
  }

  start(intervalMs = PICKUP_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), intervalMs);
    this.timer.unref?.();
    this.kick();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Runs one pass now, or right after the pass in progress. */
  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.tick()
      .then(() => undefined)
      .catch((error: unknown) =>
        this.deps.log?.(`agent pickup: ${error instanceof Error ? error.message : error}`),
      )
      .finally(() => {
        this.running = undefined;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  /** One pass; returns the task keys it started. */
  async tick(): Promise<string[]> {
    if (!this.deps.accepting()) return [];
    const agents = await this.deps.agents();
    if (!agents.some((a) => a.auto_pickup && !a.archived_at)) return [];
    const now = this.deps.now?.() ?? Date.now();
    const busy = new Map<string, number>();
    const candidates: PickupCandidate[] = [];
    for (const { name } of await this.deps.projects()) {
      const [board, tasks] = await Promise.all([this.deps.issues.list(name), this.deps.tasks(name)]);
      for (const t of tasks)
        if (t.workflow === 'agent' && t.agent && WORKING.has(t.stage))
          busy.set(t.agent, (busy.get(t.agent) ?? 0) + 1);
      for (const i of board.items)
        candidates.push({
          project: name,
          key: i.key,
          ...(i.assignee ? { assignee: i.assignee } : {}),
          status: i.status,
          priority: i.priority,
          created_at: i.created_at,
          archived: Boolean(i.archived_at),
          ...(i.run ? { run_stage: i.run.stage } : {}),
        });
    }
    const id = (t: PickupCandidate) => `${t.project}/${t.key}`;
    const started: string[] = [];
    for (const task of pickupPlan(agents, candidates, busy, (t) => (this.retryAt.get(id(t)) ?? 0) > now)) {
      if (!this.deps.accepting()) break;
      const agent = agents.find((a) => a.id === task.assignee)!;
      try {
        await this.deps.issues.move({ project: task.project, key: task.key, to: 'in_progress' });
        this.retryAt.delete(id(task));
        started.push(task.key);
        this.deps.log?.(`agent pickup: ${agent.name} started ${task.key}`);
      } catch (error) {
        this.retryAt.set(id(task), now + PICKUP_RETRY_MS);
        const reason = error instanceof Error ? error.message : String(error);
        await this.deps.issues
          .note({
            project: task.project,
            key: task.key,
            kind: 'pickup-failed',
            message: `${agent.name} could not start: ${reason}`,
          })
          .catch(() => undefined);
      }
    }
    return started;
  }
}
