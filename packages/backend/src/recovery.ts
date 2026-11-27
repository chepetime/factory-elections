// What happens to every non-final record after a restart, and while the backend runs.
//
// Each record type has a table, one rule per state. `satisfies Record<State, RecoveryRule>` makes
// the compiler refuse a new state that has no rule, and recovery.test.ts checks the tables against
// the schemas at run time. A rule says who moves the record on:
//   final       nothing to do.
//   idle        nothing is in flight; a person's command starts it, and no inbox item is needed.
//   person      a person acts, and an inbox item says so.
//   reconciler  a named step moves it. Startup recovery runs the ones marked `recover`; the others
//               have an owner that runs on its own (the sweeper, the feature ticker).
// A detector then lists records whose state says someone works on them while nobody does and no
// write has touched them for an hour, and puts them in the inbox (docs/state-machines.md).
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  FeatureStage,
  ReviewLoopState,
  ReviewState,
  STAGES,
  TicketState,
  recoveryInboxItems,
  runWorking,
  stuckInboxItems,
  unsettledFor,
  withStage,
  taskCommandBlockers,
  type InboxItem,
  type RecoveryProblem,
  type RecoveryReport,
  type Stage,
  type StuckRecord,
  type TaskRecord,
} from '@factory/core';
import type { TaskStore } from '@factory/adapters-fs';
import type { ChatService } from '@factory/agents';
import type { Dispatcher, Release } from '@factory/dispatcher';
import type { ReviewService } from '@factory/pr-reviews';
import type { Target } from '@factory/backend-client/protocol';
import type { FeatureService } from './features.ts';
import type { ReviewLoop } from './review-loop.ts';
import { RunRecord, type RunCommand } from './run-record.ts';

export type Reconciler =
  | 'requeue'
  | 'interrupt'
  | 'resume-loop'
  | 'settle-loop'
  | 'sync-ticket'
  | 'clear-working'
  | 'sweeper'
  | 'ticker';

export type RecoveryRule =
  | { kind: 'final'; note: string }
  | { kind: 'idle'; note: string }
  | { kind: 'person'; note: string }
  | { kind: 'reconciler'; reconciler: Reconciler; recover: boolean; note: string };

const final = (note: string): RecoveryRule => ({ kind: 'final', note });
const idle = (note: string): RecoveryRule => ({ kind: 'idle', note });
const person = (note: string): RecoveryRule => ({ kind: 'person', note });
/** `recover`: startup recovery runs it. Without it the owner named in the note runs on its own. */
const by = (reconciler: Reconciler, note: string, recover = true): RecoveryRule => ({
  kind: 'reconciler',
  reconciler,
  recover,
  note,
});

/** `run.json` state. Recovery reads the task's latest run; older unfinished runs are interrupted. */
export const RUN_RECOVERY = {
  queued: by('requeue', 'Recovery queues the run again; if it cannot, it marks it interrupted.'),
  running: by(
    'interrupt',
    'Recovery marks it interrupted with cleanup uncertain, and fails a task at a working stage.',
  ),
  completed: final('Settled.'),
  failed: final('Settled.'),
  interrupted: person(
    'The task shows a failed or blocked item; a person runs it again. Cleanup uncertain waits for a confirm.',
  ),
} satisfies Record<RunRecord['state'], RecoveryRule>;

/** Task stage. Only `coding` and `reviewing` mean a run is working; the rest wait. */
export const STAGE_RECOVERY = {
  queued: by('requeue', 'The task waits for its run; recovery queues a queued run again.'),
  classified: idle('Waits for a person to start the run.'),
  blocked: person('Inbox: blocked. A person answers or opens a new task.'),
  coding: by('interrupt', 'No live run: recovery moves the task to failed so a person can run it again.'),
  'verification-failed': person('Inbox: failed. A person reads the log and runs again.'),
  reviewing: by('interrupt', 'No live run: recovery moves the task to failed so a person can run it again.'),
  'awaiting-approval': person('Inbox: gate. A person approves or rejects.'),
  approved: idle('Waits for a person to open the pull request.'),
  rejected: idle('Waits for a person to revise.'),
  'pr-opened': final('The review loop and PR tending own it from here (their tables).'),
  failed: person('Inbox: failed. A person reads the log and runs again.'),
} satisfies Record<Stage, RecoveryRule>;

/** PR review turn state (pr-reviews). */
export const REVIEW_RECOVERY = {
  preparing: final('Lives in memory only; a restart drops it, and a review with no turn reads as none.'),
  running: by(
    'sweeper',
    'A turn with no live owner reads as interrupted; the sweeper stops one silent for 30 minutes.',
    false,
  ),
  completed: final('Settled; the findings reach the inbox as a review item.'),
  failed: final('Settled.'),
  stopped: final('Settled.'),
  interrupted: by(
    'resume-loop',
    'A review that belongs to a review loop starts again (twice at most). Any other waits for a person to start a new one.',
  ),
} satisfies Record<ReviewState, RecoveryRule>;

/** `review-loop.json` state. */
export const REVIEW_LOOP_RECOVERY = {
  reviewing: by(
    'resume-loop',
    'Interrupted review: resumed, at most twice per cycle, then the loop stops with a reason.',
  ),
  fixing: by(
    'settle-loop',
    'No queued or live run: the loop stops with a reason and an inbox item; the PR stays a draft.',
  ),
  ready: final('The PR left draft.'),
  stopped: idle('Stopped with a reason in the task activity; a person sends the follow-up again.'),
} satisfies Record<ReviewLoopState['state'], RecoveryRule>;

/** Feature stage. */
export const FEATURE_STAGE_RECOVERY = {
  grilling: person('Inbox: question.'),
  spec: person('Inbox: approve-spec.'),
  'spec-approved': idle('Waits for a person to write the board.'),
  board: person('Inbox: approve-board.'),
  implementing: by('ticker', 'The feature ticker starts and follows tickets on its own, every tick.', false),
  qa: person('Inbox: qa.'),
  done: final('Settled.'),
  cancelled: final('Settled.'),
} satisfies Record<FeatureStage, RecoveryRule>;

/** Feature ticket state. */
export const TICKET_RECOVERY = {
  waiting: by('ticker', 'The ticker starts it once its blockers are done.', false),
  'waiting-merge': person('Inbox: merge. A person merges the blockers and marks them merged.'),
  running: by(
    'sync-ticket',
    'Follows its task: done at the approval gate or later, failed when the task failed; a missing task starts over as waiting.',
  ),
  done: final('Settled.'),
  failed: person('Inbox: failed. A person retries the ticket.'),
} satisfies Record<TicketState, RecoveryRule>;

/** The stored `working` flag of a feature or a chat. */
export const WORKING_RECOVERY = {
  feature: by(
    'clear-working',
    'No execution holds the key: recovery clears the flag in storage and the feature says the step was cut. Reads hide it too.',
  ),
  chat: by(
    'clear-working',
    'No execution holds the key: recovery clears the flag in storage. Reads hide it too.',
  ),
} satisfies Record<'feature' | 'chat', RecoveryRule>;

export const RECOVERY_TABLES = {
  run: RUN_RECOVERY,
  stage: STAGE_RECOVERY,
  review: REVIEW_RECOVERY,
  'review-loop': REVIEW_LOOP_RECOVERY,
  'feature-stage': FEATURE_STAGE_RECOVERY,
  ticket: TICKET_RECOVERY,
  working: WORKING_RECOVERY,
} as const;

/** The schema values each table must cover, for the test that compares them. */
export const RECOVERY_STATES = {
  run: RunRecord.shape.state.options,
  stage: STAGES,
  review: ReviewState.options,
  'review-loop': ReviewLoopState.shape.state.options,
  'feature-stage': FeatureStage.options,
  ticket: TicketState.options,
  working: ['feature', 'chat'],
} as const;

export const INTERRUPTED =
  'The backend stopped during this run. Run the task again to continue from the last saved step.';

export interface RecoveryDeps {
  projects: { list(): Promise<{ name: string }[]> };
  tasks: Pick<TaskStore, 'list' | 'read' | 'write' | 'clearDeadLock' | 'acquireLock' | 'taskPath'>;
  storage: {
    writeDocument(path: string, data: unknown): Promise<void>;
    readDocument(path: string): Promise<unknown>;
  };
  latest(target: Target): Promise<{ record: RunRecord; dir: string } | undefined>;
  dispatcher: Pick<Dispatcher, 'active' | 'reserve' | 'accepting' | 'scheduledFor'>;
  schedule(
    command: RunCommand,
    record: RunRecord,
    dir: string,
    unlock: () => Promise<void>,
    reservation: Release,
  ): void;
  reviewLoop: Pick<ReviewLoop, 'state' | 'resumeInterrupted' | 'recoverFixing'>;
  reviews: Pick<ReviewService, 'detail'>;
  features: Pick<FeatureService, 'reconcile' | 'unowned'>;
  chats: Pick<ChatService, 'clearStaleWorking'>;
  /** How often recovery retries what it could not read. */
  retryMs: number;
  /** How often the detector looks, and how long a record may sit unsettled before it is reported. */
  checkMs: number;
  stuckAfterMs: number;
  now?: () => number;
  log?: (line: string) => void;
}

type Settled = 'requeued' | 'interrupted' | undefined;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class Recovery {
  /** What startup recovery could not settle; `pending` until the first recovery ends. */
  report: RecoveryReport = { state: 'pending', problems: [] };
  private retry?: NodeJS.Timeout;
  private detector?: NodeJS.Timeout;
  private stuck: StuckRecord[] = [];
  /** Records recovery itself stopped; they stay until the next start. */
  private settled: StuckRecord[] = [];
  private readonly logged = new Set<string>();
  private readonly deps: RecoveryDeps;
  constructor(deps: RecoveryDeps) {
    this.deps = deps;
  }
  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
  private log(line: string): void {
    this.deps.log?.(line);
  }

  /** Inbox items: storage problems recovery could not read, records it stopped, records stuck. */
  inboxItems(): InboxItem[] {
    return [...recoveryInboxItems(this.report), ...stuckInboxItems([...this.settled, ...this.stuck])];
  }

  /** Stops the timers (shutdown). */
  stop(): void {
    clearTimeout(this.retry);
    clearInterval(this.detector);
    this.retry = undefined;
    this.detector = undefined;
  }

  /**
   * After a restart: a run that was running is marked interrupted and its task made resumable; a
   * run that never started is queued again; older unfinished runs are interrupted; review loops,
   * feature tickets and `working` flags that nothing owns are settled (the tables above). Call once,
   * while this service owns the data root. A project or task it cannot read goes into the report,
   * and it is retried until it succeeds.
   */
  async recover(): Promise<{ requeued: number; interrupted: number; problems: number }> {
    const counts = { requeued: 0, interrupted: 0, problems: 0 };
    const problems: RecoveryProblem[] = [];
    const failed = (project: string, error: unknown, task_id?: string) =>
      problems.push({
        project,
        ...(task_id ? { task_id } : {}),
        error: message(error),
        since: this.problemSince(project, task_id),
      });
    let projects: { name: string }[] = [];
    try {
      projects = await this.deps.projects.list();
    } catch (error) {
      failed('*', error);
    }
    for (const project of projects) {
      let tasks: TaskRecord[];
      try {
        tasks = await this.deps.tasks.list(project.name);
      } catch (error) {
        failed(project.name, error);
        continue;
      }
      for (const task of tasks) {
        try {
          const result = await this.reconcileTask(project.name, task.id);
          if (result) counts[result]++;
          counts.interrupted += await this.settleOlderRuns(project.name, task.id);
        } catch (error) {
          failed(project.name, error, task.id);
        }
      }
      // After the tasks: tickets and loops read the task stages the pass above settled.
      await this.settleProject(project.name, tasks);
    }
    await this.deps.chats
      .clearStaleWorking()
      .then(
        (cleared) =>
          cleared.length &&
          this.log(`recovery: cleared a stale working flag on chats ${cleared.map((c) => c.id).join(', ')}`),
      )
      .catch((error: unknown) => this.log(`recovery: chats: ${message(error)}`));
    counts.problems = problems.length;
    this.finish(problems);
    this.startDetector();
    return counts;
  }

  /** Reconciles only what the last recovery could not read. Safe to call again at any time. */
  async reconcile(): Promise<RecoveryReport> {
    if (this.report.state !== 'degraded') return this.report;
    const problems: RecoveryProblem[] = [];
    for (const problem of this.report.problems) {
      try {
        if (problem.project === '*') {
          await this.recover();
          return this.report;
        }
        const ids = problem.task_id
          ? [problem.task_id]
          : (await this.deps.tasks.list(problem.project)).map((t) => t.id);
        for (const id of ids) {
          try {
            await this.reconcileTask(problem.project, id);
            await this.settleOlderRuns(problem.project, id);
          } catch (error) {
            problems.push({ ...problem, task_id: id, error: message(error) });
          }
        }
      } catch (error) {
        problems.push({ ...problem, error: message(error) });
      }
    }
    this.finish(problems);
    return this.report;
  }

  private problemSince(project: string, task_id?: string): string {
    return (
      this.report.problems.find((p) => p.project === project && p.task_id === task_id)?.since ??
      new Date().toISOString()
    );
  }

  private finish(problems: RecoveryProblem[]): void {
    this.report = {
      state: problems.length ? 'degraded' : 'ok',
      checked_at: new Date().toISOString(),
      problems,
    };
    clearTimeout(this.retry);
    this.retry = undefined;
    if (problems.length && this.deps.dispatcher.accepting) {
      this.retry = setTimeout(() => void this.reconcile().catch(() => undefined), this.deps.retryMs);
      this.retry.unref();
    }
  }

  /**
   * Settles one task's latest run if no live owner holds it: queued again, or interrupted. Throws
   * when the run cannot be read, so the caller reports it. A missing run is not an error.
   */
  private async reconcileTask(project: string, id: string): Promise<Settled> {
    const { tasks, dispatcher } = this.deps;
    const latest = await this.deps.latest({ project, id });
    if (!latest || dispatcher.active(latest.record.id)) return undefined;
    const { record, dir } = latest;
    if (record.state !== 'queued' && record.state !== 'running') return undefined;
    await tasks.clearDeadLock(project, id);
    if (record.state === 'queued') {
      const queued = await this.requeue(record, dir);
      if (queued === 'scheduled') return 'requeued';
      if (queued === 'settled') return undefined;
    }
    await this.markInterrupted(record, dir);
    const current = await tasks.read(project, id);
    if (runWorking(current.stage))
      await tasks.write(withStage(current, new Date().toISOString(), 'failed', INTERRUPTED));
    return 'interrupted';
  }

  private async markInterrupted(record: RunRecord, dir: string, error?: string): Promise<void> {
    await this.deps.storage.writeDocument(join(dir, 'run.json'), {
      ...record,
      state: 'interrupted',
      outcome: 'interrupted',
      // Processes of a run that was running at a crash are not known to be gone.
      ...(record.state === 'running'
        ? { cleanup: { status: 'uncertain', reasons: ['the backend stopped while the run was running'] } }
        : {}),
      error:
        error ??
        (record.state === 'queued' ? 'The run could not be queued again after a restart.' : INTERRUPTED),
      finished_at: new Date().toISOString(),
    });
  }

  /**
   * A run that is not the task's latest and is still `queued` or `running` has no owner: a newer
   * run owns the task. It is marked interrupted (cleanup uncertain if it was running) and the task
   * stage is left alone. Returns how many it settled.
   */
  private async settleOlderRuns(project: string, id: string): Promise<number> {
    const { dispatcher, storage, tasks } = this.deps;
    const latest = await this.deps.latest({ project, id });
    if (!latest || dispatcher.scheduledFor(`${project}/${id}`)) return 0;
    const runs = join(dirname(tasks.taskPath(project, id)), 'runs');
    let settled = 0;
    for (const name of await readdir(runs).catch(() => [] as string[])) {
      if (name === latest.record.id) continue;
      const dir = join(runs, name);
      const parsed = RunRecord.safeParse(
        await storage.readDocument(join(dir, 'run.json')).catch(() => undefined),
      );
      if (!parsed.success || (parsed.data.state !== 'queued' && parsed.data.state !== 'running')) continue;
      if (dispatcher.active(parsed.data.id)) continue;
      await this.markInterrupted(
        parsed.data,
        dir,
        'A newer run took over the task before this one finished.',
      );
      settled++;
    }
    return settled;
  }

  /**
   * Queues a recovered run again. `settled`: under the task lock the run turned out to be owned or
   * no longer queued, so nothing is done. `refused`: it cannot run again.
   */
  private async requeue(record: RunRecord, dir: string): Promise<'scheduled' | 'settled' | 'refused'> {
    const { dispatcher, tasks } = this.deps;
    const reservation = dispatcher.reserve();
    if (!reservation) return 'refused';
    let release: (() => Promise<void>) | undefined;
    try {
      release = await tasks.acquireLock(record.project, record.task_id);
      // Read again under the lock: a start in this process may have written and scheduled it.
      const fresh = await this.deps.latest({ project: record.project, id: record.task_id });
      if (
        !fresh ||
        fresh.record.id !== record.id ||
        fresh.record.state !== 'queued' ||
        dispatcher.active(record.id)
      ) {
        reservation();
        await release();
        return 'settled';
      }
      const task = await tasks.read(record.project, record.task_id);
      if (taskCommandBlockers(task, record.action).length) throw new Error('blocked');
      this.deps.schedule(record.command, record, dir, release, reservation);
      return 'scheduled';
    } catch {
      reservation();
      await release?.();
      return 'refused';
    }
  }

  /** Features and review loops of one project. A failure is logged, not retried: the detector sees what stays. */
  private async settleProject(project: string, tasks: TaskRecord[]): Promise<void> {
    try {
      const { cleared, tickets } = await this.deps.features.reconcile(project);
      if (cleared.length) this.log(`recovery: cleared the working flag of features ${cleared.join(', ')}`);
      if (tickets.length) this.log(`recovery: settled tickets ${tickets.join(', ')}`);
    } catch (error) {
      this.log(`recovery: features of ${project}: ${message(error)}`);
    }
    for (const task of tasks) {
      try {
        await this.settleLoop(task);
      } catch (error) {
        this.log(`recovery: review loop ${project}/${task.id}: ${message(error)}`);
      }
    }
  }

  private async settleLoop(task: TaskRecord): Promise<void> {
    const { reviewLoop, reviews, dispatcher } = this.deps;
    const loop = await reviewLoop.state(task);
    if (!loop) return;
    if (loop.state === 'fixing' && !dispatcher.scheduledFor(`${task.project}/${task.id}`)) {
      if (await reviewLoop.recoverFixing(task)) await this.noteStopped(task);
    } else if (loop.state === 'reviewing') {
      const review = await reviews.detail({ project: task.project, number: loop.pr }).catch(() => undefined);
      if (review?.state !== 'interrupted') return;
      await reviewLoop.resumeInterrupted(task);
      if ((await reviewLoop.state(task))?.state === 'stopped') await this.noteStopped(task);
    }
  }

  private async noteStopped(task: TaskRecord): Promise<void> {
    const loop = await this.deps.reviewLoop.state(task);
    this.settled.push({
      project: task.project,
      kind: 'review-loop',
      id: task.id,
      state: loop?.state ?? 'stopped',
      since: loop?.updated_at ?? new Date(this.now()).toISOString(),
      settled: true,
      ...(loop?.reason ? { detail: loop.reason } : {}),
    });
  }

  // ---------- the stuck detector ----------

  /** Looks every `checkMs`. The timer does not keep the process alive. */
  startDetector(): void {
    if (this.detector) return;
    this.detector = setInterval(() => void this.detectStuck().catch(() => undefined), this.deps.checkMs);
    this.detector.unref();
  }

  /**
   * Finds records that say someone works on them while nobody does, unwritten for `stuckAfterMs`
   * (a run with no owner, a review loop with no live review or run, a feature step, a ticket or a
   * chat reply nothing holds), keeps them for the inbox and logs their ids once. `at` is the clock
   * in ms since the epoch, for tests.
   */
  async detectStuck(at = this.now()): Promise<StuckRecord[]> {
    const { dispatcher, reviewLoop, reviews } = this.deps;
    const found: StuckRecord[] = [];
    const old = (since: string) => unsettledFor(since, at, this.deps.stuckAfterMs);
    for (const project of await this.deps.projects.list()) {
      const tasks = await this.deps.tasks.list(project.name).catch(() => [] as TaskRecord[]);
      for (const task of tasks) {
        const key = `${project.name}/${task.id}`;
        const latest = await this.deps.latest({ project: project.name, id: task.id }).catch(() => undefined);
        if (
          latest &&
          (latest.record.state === 'queued' || latest.record.state === 'running') &&
          !dispatcher.active(latest.record.id) &&
          old(latest.record.created_at)
        )
          found.push({
            project: project.name,
            kind: 'run',
            id: task.id,
            state: latest.record.state,
            since: latest.record.created_at,
          });
        const loop = await reviewLoop.state(task);
        if (!loop || !old(loop.updated_at)) continue;
        if (loop.state === 'fixing' && !dispatcher.scheduledFor(key))
          found.push({
            project: project.name,
            kind: 'review-loop',
            id: task.id,
            state: 'fixing',
            since: loop.updated_at,
          });
        if (loop.state === 'reviewing') {
          const live = (
            await reviews.detail({ project: project.name, number: loop.pr }).catch(() => undefined)
          )?.state;
          if (live !== 'running' && live !== 'preparing')
            found.push({
              project: project.name,
              kind: 'review-loop',
              id: task.id,
              state: 'reviewing',
              since: loop.updated_at,
            });
        }
      }
      const unowned = await this.deps.features
        .unowned(project.name, (taskId) => dispatcher.scheduledFor(`${project.name}/${taskId}`))
        .catch(() => []);
      for (const u of unowned)
        if (old(u.since))
          found.push({
            project: project.name,
            kind: u.kind,
            id: u.id,
            state: u.state,
            since: u.since,
            ...(u.ticket ? { ticket: u.ticket } : {}),
          });
    }
    for (const chat of await this.deps.chats.clearStaleWorking(true).catch(() => []))
      if (old(chat.updated_at))
        found.push({ project: '*', kind: 'chat', id: chat.id, state: 'replying', since: chat.updated_at });
    this.stuck = found;
    for (const item of stuckInboxItems(found))
      if (!this.logged.has(item.id)) {
        this.logged.add(item.id);
        this.log(`recovery: stuck ${item.id}`);
      }
    return found;
  }
}
