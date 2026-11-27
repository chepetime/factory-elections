// Starts Todo tasks assigned to agents when those agents have free slots. A start that fails (an
// unapproved profile, a dirty repository) leaves one note on the task and waits before trying again.
import {
  blockerGate,
  pickupPlan,
  runFinished,
  type AgentProfile,
  type PickupCandidate,
  type TaskRecord,
} from '@factory/core';
import type { AgentBoard } from './ports.ts';
import { memoryPickupState, type PickupState, type PickupStateStore } from './pickup-state.ts';

/** How long a task that could not start waits before the next try. */
export const PICKUP_RETRY_MS = 10 * 60_000;
export const PICKUP_INTERVAL_MS = 20_000;
/** Each failure in a row doubles the wait, up to this. */
export const PICKUP_RETRY_MAX_MS = 60 * 60_000;

const retryWait = (failures: number) => Math.min(PICKUP_RETRY_MS * 2 ** (failures - 1), PICKUP_RETRY_MAX_MS);

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
  /** Keeps the waits and "no agent" answers across restarts. Default: memory only. */
  state?: PickupStateStore;
  now?: () => number;
  log?: (line: string) => void;
};

export class AgentPickup {
  private readonly deps: PickupDeps;
  private readonly state: PickupStateStore;
  /** Tasks that failed to start: the time of the last failure and how many failed in a row. */
  private readonly retry = new Map<string, { at: number; failures: number }>();
  private loaded?: Promise<void>;
  private saving: Promise<void> = Promise.resolve();
  /** Tasks the coordinator found no agent for, with the task's updated time then: asked again after an edit. */
  private readonly unrouted = new Map<string, string>();
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private again = false;
  constructor(deps: PickupDeps) {
    this.deps = deps;
    this.state = deps.state ?? memoryPickupState();
  }

  private waiting(id: string, now: number): boolean {
    const r = this.retry.get(id);
    return r !== undefined && r.at + retryWait(r.failures) > now;
  }
  private failed(id: string, now: number): void {
    this.retry.set(id, { at: now, failures: (this.retry.get(id)?.failures ?? 0) + 1 });
  }
  /** Reads the stored state once, before the first pass. A bad file starts empty. */
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const stored = await this.state.load();
        for (const [id, r] of Object.entries(stored?.retry ?? {})) {
          const at = Date.parse(r.at);
          if (Number.isFinite(at)) this.retry.set(id, { at, failures: r.failures });
        }
        for (const [id, at] of Object.entries(stored?.unrouted ?? {})) this.unrouted.set(id, at);
      } catch (error) {
        this.deps.log?.(
          `agent pickup: starting with empty state, cannot read it: ${error instanceof Error ? error.message : error}`,
        );
      }
    })();
    return this.loaded;
  }
  /** Writes the state after a change; writes run one after another and a failed one only logs. */
  private persist(): Promise<void> {
    const snapshot: PickupState = {
      retry: Object.fromEntries(
        [...this.retry].map(([id, r]) => [id, { at: new Date(r.at).toISOString(), failures: r.failures }]),
      ),
      unrouted: Object.fromEntries(this.unrouted),
    };
    this.saving = this.saving
      .then(() => this.state.save(snapshot))
      .catch((error: unknown) =>
        this.deps.log?.(`agent pickup: cannot save state: ${error instanceof Error ? error.message : error}`),
      );
    return this.saving;
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
    await this.load();
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
    const live = new Set<string>();
    const listed = new Set<string>();
    const candidates: PickupCandidate[] = [];
    for (const { name } of await this.deps.projects()) {
      const [board, tasks] = await Promise.all([this.deps.issues.list(name), this.deps.tasks(name)]);
      for (const t of tasks)
        if (t.workflow === 'agent' && t.agent && this.deps.scheduled(name, t.id))
          busy.set(t.agent, (busy.get(t.agent) ?? 0) + 1);
      const records = new Map(tasks.map((t) => [t.id, t]));
      listed.add(name);
      for (const i of board.items) {
        if (!i.archived_at) live.add(`${name}/${i.key}`);
        // A review ticket starts when you move it to In progress, never on its own.
        if (i.review) continue;
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
          // FE-22 needs FE-21's code: it waits until FE-21 is Done, or stacks on FE-21's open PR.
          ...(i.blocked_by.length &&
          blockerGate(i.blocked_by, board.items, (id) => records.get(id)).kind === 'wait'
            ? { waits: true }
            : {}),
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
    // Archived or deleted tasks leave the state, so it does not grow.
    let changed = false;
    for (const map of [this.retry, this.unrouted])
      for (const key of map.keys())
        if (listed.has(key.slice(0, key.indexOf('/'))) && !live.has(key))
          changed = map.delete(key) || changed;
    // Unassigned Todo tasks get an agent from the coordinator first, one call per task.
    for (const task of this.deps.route ? toRoute : []) {
      if (!this.deps.accepting()) break;
      if (this.waiting(id(task), now) || this.unrouted.get(id(task)) === task.updated_at) continue;
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
          changed = true;
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
        this.failed(id(task), now);
        changed = true;
        this.deps.log?.(
          `agent pickup: routing ${task.key}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    const started: string[] = [];
    for (const task of pickupPlan(agents, candidates, busy, (t) => this.waiting(id(t), now))) {
      if (!this.deps.accepting()) break;
      const agent = agents.find((a) => a.id === task.assignee)!;
      try {
        const blocked = await this.deps.blocker?.(task.project);
        if (blocked) throw new Error(blocked);
        await this.deps.issues.move({ project: task.project, key: task.key, to: 'in_progress' });
        changed = this.retry.delete(id(task)) || changed;
        started.push(task.key);
        this.deps.log?.(`agent pickup: ${agent.name} started ${task.key}`);
      } catch (error) {
        this.failed(id(task), now);
        changed = true;
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
    if (changed) await this.persist();
    return started;
  }
}
