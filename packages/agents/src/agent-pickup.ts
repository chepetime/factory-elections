// Starts Todo tasks assigned to agents when those agents have free slots. A start that fails (an
// unapproved profile, a dirty repository) leaves one note on the task and waits before trying again.
import {
  pickupPlan,
  runFinished,
  type AgentProfile,
  type PickupCandidate,
  type TaskRecord,
} from '@factory/core';
import type { AgentBoard } from './ports.ts';

/** How long a task that could not start waits before the next try. */
export const PICKUP_RETRY_MS = 10 * 60_000;
export const PICKUP_INTERVAL_MS = 20_000;

export type PickupDeps = {
  agents: () => Promise<AgentProfile[]>;
  projects: () => Promise<{ name: string }[]>;
  issues: Pick<AgentBoard, 'list' | 'move' | 'note' | 'update'>;
  tasks: (project: string) => Promise<TaskRecord[]>;
  /** Whether the backend has a run queued or working for the task. Only those occupy an agent. */
  scheduled: (project: string, id: string) => boolean;
  accepting: () => boolean;
  /**
   * Picks the agent for a Todo task nobody assigned (the coordinator, Mika). Undefined `agent`
   * means no agent fits; `by` names the coordinator for the activity feed. Absent: no routing.
   */
  route?: (task: {
    project: string;
    key: string;
    title: string;
    description: string;
  }) => Promise<{ by: string; agent?: string; reason: string } | undefined>;
  /** Why runs cannot start in a project now; checked first, so a refused start changes nothing. */
  blocker?: (project: string) => Promise<string | undefined>;
  now?: () => number;
  log?: (line: string) => void;
};

export class AgentPickup {
  private readonly deps: PickupDeps;
  private readonly retryAt = new Map<string, number>();
  /** Tasks the coordinator found no agent for, with the task's updated time then: asked again after an edit. */
  private readonly unrouted = new Map<string, string>();
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
    const toRoute: {
      project: string;
      key: string;
      title: string;
      description: string;
      updated_at: string;
    }[] = [];
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
        if (!i.assignee && i.status === 'todo' && !i.archived_at && (!i.run || runFinished(i.run.stage)))
          toRoute.push({
            project: name,
            key: i.key,
            title: i.title,
            description: i.description,
            updated_at: i.updated_at,
          });
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
    const id = (t: { project: string; key: string }) => `${t.project}/${t.key}`;
    // Unassigned Todo tasks get an agent from the coordinator first, one call per task.
    for (const task of this.deps.route ? toRoute : []) {
      if (!this.deps.accepting()) break;
      if ((this.retryAt.get(id(task)) ?? 0) > now || this.unrouted.get(id(task)) === task.updated_at)
        continue;
      try {
        const choice = await this.deps.route!(task);
        if (!choice) continue;
        if (!choice.agent) {
          const noted = await this.deps.issues.note({
            project: task.project,
            key: task.key,
            kind: 'route-none',
            message: `${choice.by} found no agent for this task: ${choice.reason}`,
          });
          // The note changes the task's time; remember the time after it, so only your edit asks again.
          this.unrouted.set(id(task), noted.updated_at);
          continue;
        }
        await this.deps.issues.update({ project: task.project, key: task.key, assignee: choice.agent });
        await this.deps.issues.note({
          project: task.project,
          key: task.key,
          kind: 'route',
          message: `${choice.by} chose ${agents.find((a) => a.id === choice.agent)?.name ?? choice.agent}: ${choice.reason}`,
        });
        const candidate = candidates.find((c) => c.project === task.project && c.key === task.key);
        if (candidate) candidate.assignee = choice.agent;
      } catch (error) {
        this.retryAt.set(id(task), now + PICKUP_RETRY_MS);
        this.deps.log?.(
          `agent pickup: routing ${task.key}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    const started: string[] = [];
    for (const task of pickupPlan(agents, candidates, busy, (t) => (this.retryAt.get(id(t)) ?? 0) > now)) {
      if (!this.deps.accepting()) break;
      const agent = agents.find((a) => a.id === task.assignee)!;
      try {
        const blocked = await this.deps.blocker?.(task.project);
        if (blocked) throw new Error(blocked);
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
