// Starts Todo tasks assigned to agents when those agents have free slots. A start that fails (an
// unapproved profile, a dirty repository) leaves one note on the task and waits before trying again.
import { pickupPlan, type AgentProfile, type PickupCandidate, type TaskRecord } from '@factory/core';
import type { IssueService } from './issues.ts';

/** How long a task that could not start waits before the next try. */
export const PICKUP_RETRY_MS = 10 * 60_000;
export const PICKUP_INTERVAL_MS = 20_000;

export type PickupDeps = {
  agents: () => Promise<AgentProfile[]>;
  projects: () => Promise<{ name: string }[]>;
  issues: Pick<IssueService, 'list' | 'move' | 'note'>;
  tasks: (project: string) => Promise<TaskRecord[]>;
  /** Whether the backend has a run queued or working for the task. Only those occupy an agent. */
  scheduled: (project: string, id: string) => boolean;
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
        if (t.workflow === 'agent' && t.agent && this.deps.scheduled(name, t.id))
          busy.set(t.agent, (busy.get(t.agent) ?? 0) + 1);
      const records = new Map(tasks.map((t) => [t.id, t]));
      for (const i of board.items) {
        const latest = i.run ? records.get(i.run.id) : undefined;
        candidates.push({
          project: name,
          key: i.key,
          ...(i.assignee ? { assignee: i.assignee } : {}),
          status: i.status,
          priority: i.priority,
          created_at: i.created_at,
          archived: Boolean(i.archived_at),
          ...(i.run ? { run_stage: i.run.stage } : {}),
          // An agent run that was created but never started (a refused start, a restart) can start again.
          ...(latest?.workflow === 'agent' &&
          latest.stage === 'queued' &&
          !this.deps.scheduled(name, latest.id)
            ? { restartable: true }
            : {}),
        });
      }
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
