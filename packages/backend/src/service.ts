import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Cause, Effect, Fiber } from 'effect';
import { z } from 'zod';
import {
  ProjectName,
  TaskId,
  TaskCommand,
  executionPhase,
  taskActions,
  taskCommandBlockers,
  withStage,
  type ModelRunner,
  type TaskControls,
} from '@factory/core';
import { type ProjectStore, type TaskStore, readProfile } from '@factory/adapters-fs';
import type { Driver } from '@factory/driver';
import { composeDriver } from './compose.ts';
import { storageFor, type DataStorage } from '@factory/adapters-data';
import { Evidence } from './evidence.ts';
import { Conflict } from './conflict.ts';
import { MAX_AGENTS, ReviewService, type ReviewDeps } from './reviews.ts';
import { ProjectSettingsService, type SettingsDetector } from './settings.ts';
export { Conflict };
import { TeamService } from './team.ts';
import { environmentChecks, type Check } from './diagnostics.ts';
import type { BackgroundRun, Command, Target } from './protocol.ts';

const TargetSchema = z.object({ project: ProjectName, id: TaskId });
const CommandSchema = TargetSchema.extend({
  action: TaskCommand,
  note: z.string().max(20_000).optional().default(''),
  head: z.string().max(64).optional().default(''),
  accept_blocking: z.boolean().optional().default(false),
  draft: z.boolean().optional().default(false),
  max_attempts: z.number().int().min(0).max(10).optional().default(0),
});
const RunRecord = z.object({
  id: TaskId,
  project: ProjectName,
  task_id: TaskId,
  action: TaskCommand,
  command: CommandSchema,
  label: z.string(),
  state: z.enum(['queued', 'running', 'completed', 'failed', 'interrupted']),
  created_at: z.string(),
  finished_at: z.string().optional(),
  error: z.string().optional(),
  dismissed: z.boolean().optional(),
});
type RunRecord = z.infer<typeof RunRecord>;

/**
 * Task runs that may execute at once. Each has its own worktree; the git adapter serializes the
 * commands that change a repository's shared refs. Reviews and task runs together stay within
 * MAX_AGENTS: a run waits in `queued` while the agents in use fill it.
 */
export const taskWorkers = () => Math.max(1, Number(process.env.FACTORY_TASK_WORKERS ?? 3) || 1);
const POOL_WAIT_MS = 2000;
/** How long shutdown waits for the active runs before it stops them. */
export const DRAIN_GRACE_MS = Number(process.env.FACTORY_DRAIN_GRACE_MS ?? 5 * 60_000);
const INTERRUPTED =
  'The backend stopped during this run. Run the task again to continue from the last saved step.';

export class BackendService {
  readonly storage: DataStorage;
  readonly tasks: TaskStore;
  readonly team: TeamService;
  readonly reviews: ReviewService;
  readonly settings: ProjectSettingsService;
  private readonly environment: () => Promise<Check[]>;
  readonly projects: ProjectStore;
  private readonly worker = Effect.runSync(Effect.makeSemaphore(taskWorkers()));
  private readonly active = new Map<string, Promise<void>>();
  /** Aborts each running run's model calls and checks, on shutdown after the grace period. */
  private readonly controllers = new Map<string, AbortController>();
  private executing = 0;
  private accepting = true;
  private reservations = 0;
  readonly root: string;
  private readonly runner?: ModelRunner;
  constructor(
    root: string,
    runner?: ModelRunner,
    environment?: () => Promise<Check[]>,
    reviewDeps?: ReviewDeps,
    detector?: SettingsDetector,
  ) {
    this.root = root;
    this.storage = storageFor(root);
    this.team = new TeamService(root);
    this.environment = environment ?? (() => environmentChecks(root));
    this.runner = runner;
    this.tasks = this.storage.tasks;
    this.projects = this.storage.projects;
    this.settings = new ProjectSettingsService(root, this.storage, this.projects, detector);
    this.reviews = new ReviewService(
      root,
      this.projects,
      (p) => this.settings.get(p),
      reviewDeps,
      () => this.executing,
    );
  }
  async diagnostics() {
    const [environment, projects] = await Promise.all([this.environment(), this.projects.list()]);
    const profiles = await Promise.all(
      projects.map(async (project) => {
        try {
          await readProfile(this.root, project.name);
          return { ...project, approved: true };
        } catch (error) {
          return {
            ...project,
            approved: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    return { environment, profiles, data_root: this.root, checked_at: new Date().toISOString() };
  }
  target(target: Target): { project: string; id: string } {
    return TargetSchema.parse(target);
  }
  driver(log: (line: string) => void = () => {}, runner = this.runner, signal?: AbortSignal): Driver {
    return composeDriver(this.root, log, runner, signal);
  }
  /** Projects with their display name and icon from settings. */
  async projectSummaries() {
    const projects = await this.projects.list();
    return Promise.all(
      projects.map(async (p) => {
        const s = await this.settings.get(p.name).catch(() => undefined);
        return { ...p, display_name: s?.display_name, icon: s?.icon };
      }),
    );
  }
  /** Registers a repository. The store checks that the path is an existing absolute directory. */
  async addProject(raw: unknown) {
    const { name, repo } = z
      .object({ name: ProjectName, repo: z.string().trim().min(1).max(4096) })
      .parse(raw);
    if (!this.accepting) throw new Conflict('Backend is shutting down');
    return this.projects.add(name, repo);
  }
  async submit(raw: unknown): Promise<string> {
    const { project, prompt } = z
      .object({ project: ProjectName, prompt: z.string().trim().min(1).max(100_000) })
      .parse(raw);
    if (!this.accepting) throw new Conflict('Backend is shutting down');
    const registered = await this.projects.read(project);
    return (await this.tasks.create(project, registered.repo, prompt, new Date().toISOString())).id;
  }
  private async perform(command: z.infer<typeof CommandSchema>, driver: Driver): Promise<string> {
    const { project, id, action } = command;
    switch (action) {
      case 'run':
        return (await driver.run(project, id, { maxAttempts: command.max_attempts || 3 })).stage;
      case 'revise':
        return (await driver.revise(project, id, command.note, { maxAttempts: command.max_attempts || 3 }))
          .stage;
      case 'approve':
        return `Approved: ${(await driver.approve(project, id, { head: command.head, note: command.note || undefined, acceptBlocking: command.accept_blocking })).approval!.head_sha}`;
      case 'reject':
        await driver.reject(project, id, command.note);
        return `Rejected: ${id}`;
      case 'open-pr':
        return (await driver.openPr(project, id, { draft: command.draft })).pr!.url;
    }
  }
  private command(raw: Command) {
    const command = CommandSchema.parse(raw);
    if (['revise', 'reject'].includes(command.action) && !command.note.trim())
      throw new Error('A note is required');
    return command;
  }
  async execute(raw: Command): Promise<string> {
    const command = this.command(raw);
    if (['run', 'revise'].includes(command.action)) throw new Error('Use StartRun for long-running work');
    if (!this.accepting) throw new Conflict('Backend is shutting down');
    return this.tasks.withLock(command.project, command.id, async () => {
      const dir = join(dirname(this.tasks.taskPath(command.project, command.id)), 'runs', randomUUID());
      if (!this.storage.config) await mkdir(dir, { recursive: true });
      const evidence = new Evidence(join(dir, 'events.jsonl'), dir.split('/').at(-1)!, this.storage);
      try {
        return await evidence.span(
          `task.${command.action}`,
          { project: command.project, task_id: command.id },
          () =>
            this.perform(
              command,
              this.driver((line) => evidence.record('log', { message: line })),
            ),
        );
      } finally {
        await evidence.close();
      }
    });
  }
  async start(raw: Command): Promise<RunRecord> {
    const command = this.command(raw);
    if (!['run', 'revise'].includes(command.action)) throw new Error('Only run and revise can be scheduled');
    if (!this.accepting || this.reservations >= 32)
      throw new Conflict('Backend is stopping or its queue is full');
    this.reservations++;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await this.tasks.acquireLock(command.project, command.id);
      const task = await this.tasks.read(command.project, command.id);
      const blockers = taskCommandBlockers(task, command.action);
      if (blockers.length) throw new Conflict(blockers.map((b) => b.message).join('; '));
      await readProfile(this.root, command.project);
      const record: RunRecord = {
        id: randomUUID(),
        project: command.project,
        task_id: command.id,
        action: command.action,
        command,
        label:
          command.action === 'run'
            ? 'Running classify → code → verify → review'
            : 'Revising: code → verify → review',
        state: 'queued',
        created_at: new Date().toISOString(),
      };
      const taskDir = dirname(this.tasks.taskPath(command.project, command.id));
      const dir = join(taskDir, 'runs', record.id);
      if (!this.storage.config) await mkdir(dir, { recursive: true });
      await this.storage.writeDocuments([
        [join(dir, 'run.json'), record],
        [join(taskDir, 'latest-run.json'), { id: record.id }],
      ]);
      this.schedule(command, record, dir, release);
      return record;
    } catch (error) {
      this.reservations--;
      await release?.();
      throw error;
    }
  }
  /** Queues an accepted run on the worker. Takes over the reservation and the task lock. */
  private schedule(
    command: z.infer<typeof CommandSchema>,
    record: RunRecord,
    dir: string,
    unlock: () => Promise<void>,
  ): void {
    {
      const work = Effect.tryPromise(() => this.work(command, record, dir)).pipe(
        this.worker.withPermits(1),
        Effect.ensuring(
          Effect.promise(async () => {
            try {
              await unlock();
            } finally {
              this.reservations--;
              this.active.delete(record.id);
            }
          }),
        ),
      );
      const fiber = Effect.runFork(work);
      const completion = Effect.runPromise(Fiber.await(fiber)).then((exit) => {
        if (exit._tag === 'Failure')
          process.stderr.write(`Run ${record.id} could not finalize: ${Cause.pretty(exit.cause)}\n`);
      });
      this.active.set(record.id, completion);
    }
  }
  private async work(command: z.infer<typeof CommandSchema>, record: RunRecord, dir: string): Promise<void> {
    // A run that had not started when shutdown began stays queued; the next start runs it.
    if (!(await this.takeAgentSlot())) return;
    const controller = new AbortController();
    this.controllers.set(record.id, controller);
    let evidence: Evidence | undefined;
    try {
      evidence = new Evidence(join(dir, 'events.jsonl'), record.id, this.storage);
      record.state = 'running';
      await this.storage.writeDocument(join(dir, 'run.json'), record);
      const sink = evidence;
      let logFailure: unknown;
      const log = (message: string) => {
        try {
          sink.log(message, { project: command.project, task_id: command.id });
        } catch (error) {
          // Log callbacks may run inside child-process data events: fail at an async boundary.
          logFailure ??= error;
        }
      };
      await sink.span(
        `task.${command.action}`,
        { project: command.project, task_id: command.id },
        async (span) => {
          const base = this.runner ?? composeDriver(this.root, log).deps.runner;
          const traced = sink.runner(base, span);
          const checked: ModelRunner = {
            run(request) {
              if (logFailure) return Promise.reject(logFailure);
              return traced.run(request);
            },
          };
          await this.perform(command, this.driver(log, checked, controller.signal));
          if (logFailure) throw logFailure;
        },
      );
      record.state = 'completed';
    } catch (error) {
      record.state = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
      // A worker error must not leave the UI thinking an owned run is still coding.
      const task = await this.tasks.read(command.project, command.id);
      if (['coding', 'reviewing'].includes(task.stage))
        await this.tasks.write(withStage(task, new Date().toISOString(), 'failed', record.error));
    } finally {
      this.controllers.delete(record.id);
      this.executing--;
      record.finished_at = new Date().toISOString();
      try {
        try {
          await this.storage.writeDocument(join(dir, 'run.json'), record);
        } finally {
          await evidence?.close();
        }
      } catch (error) {
        // Evidence durability is part of completion, even if the workflow itself succeeded.
        record.state = 'failed';
        record.error = [
          record.error,
          `Run finalization failed: ${error instanceof Error ? error.message : String(error)}`,
        ]
          .filter(Boolean)
          .join('\n');
        await this.storage.writeDocument(join(dir, 'run.json'), record);
      }
    }
  }
  private async latest(target: Target): Promise<{ record: RunRecord; dir: string } | undefined> {
    const { project, id } = this.target(target);
    const taskDir = dirname(this.tasks.taskPath(project, id));
    let pointer;
    try {
      pointer = (await this.storage.readDocument(join(taskDir, 'latest-run.json'))) as { id: string };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const runId = TaskId.parse(pointer.id);
    const dir = join(taskDir, 'runs', runId);
    const record = RunRecord.parse(await this.storage.readDocument(join(dir, 'run.json')));
    if (record.project !== project || record.task_id !== id || record.id !== runId)
      throw new Error('Run identity mismatch');
    return { record, dir };
  }
  async background(target: Target, includeLog = true): Promise<BackgroundRun> {
    const latest = await this.latest(target);
    if (!latest) return { running: false, phase: 'idle' };
    const { record, dir } = latest;
    const unfinished = ['queued', 'running'].includes(record.state);
    const running = this.active.has(record.id);
    let logTail: string | undefined;
    if (includeLog && !record.dismissed && this.storage.config) {
      const tail = await this.storage.artifactTail(join(dir, 'run.log'));
      logTail = tail && `${tail.length > 8000 ? '…' : ''}${tail.slice(-8000)}`;
    }
    if (includeLog && !record.dismissed && !this.storage.config) {
      const file = await open(join(dir, 'run.log'), 'r').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (file)
        try {
          const { size } = await file.stat();
          const start = Math.max(0, size - 32_000);
          const bytes = Buffer.alloc(Math.min(size, 32_000));
          const { bytesRead } = await file.read(bytes, 0, bytes.length, start);
          const text = bytes.subarray(0, bytesRead).toString('utf8');
          logTail = `${start > 0 || text.length > 8000 ? '…' : ''}${text.slice(-8000)}`;
        } finally {
          await file.close();
        }
    }
    return {
      running,
      phase: executionPhase(record.state, running),
      runId: record.id,
      label: record.label,
      logTail,
      state: unfinished && !running ? 'interrupted' : record.state,
      error:
        unfinished && !running
          ? 'Run interrupted; inspect evidence and stale command lock before recovery.'
          : record.error,
    };
  }
  async controls(target: Target): Promise<TaskControls> {
    const { project, id } = this.target(target);
    let task = await this.tasks.read(project, id);
    let head_sha: string | undefined;
    let gate_error: string | undefined;
    let diff_stat: string | undefined;
    let execution: TaskControls['execution'];
    try {
      execution = (await this.background(target, false)).phase ?? 'unavailable';
    } catch {
      execution = 'unavailable';
    }
    if (task.worktree) {
      try {
        const gate = await this.driver().gate(project, id);
        task = gate.task;
        head_sha = gate.headSha;
        diff_stat = gate.diffStat;
      } catch (error) {
        gate_error = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      task,
      execution,
      head_sha,
      diff_stat,
      gate_error,
      actions: taskActions(task, execution, head_sha),
    };
  }
  async clearLog(target: Target): Promise<void> {
    const { project, id } = this.target(target);
    await this.tasks.withLock(project, id, async () => {
      const latest = await this.latest(target);
      if (latest)
        await this.storage.writeDocument(join(latest.dir, 'run.json'), { ...latest.record, dismissed: true });
    });
  }
  /**
   * Stops acceptance, lets the active run finish for `graceMs`, then stops its model calls and
   * checks. Queued runs that have not started stay queued for the next start.
   */
  /**
   * Waits until reviews and task runs leave a free agent, then takes it. False when shutdown
   * began first. The count and the increment happen with no await between them.
   */
  private async takeAgentSlot(): Promise<boolean> {
    for (;;) {
      if (!this.accepting) return false;
      const reviews = await this.reviews.agentsInUse().catch(() => 0);
      if (!this.accepting) return false;
      if (this.executing + reviews < MAX_AGENTS) {
        this.executing++;
        return true;
      }
      await new Promise((done) => setTimeout(done, POOL_WAIT_MS));
    }
  }
  async drain(graceMs = DRAIN_GRACE_MS): Promise<void> {
    this.accepting = false;
    const deadline = setTimeout(() => {
      for (const controller of this.controllers.values()) controller.abort();
    }, graceMs);
    try {
      // Acceptance already in flight may be reserving a lock or writing its durable record.
      while (this.reservations > 0) {
        const pending = [...this.active.values()];
        if (pending.length) await Promise.all(pending);
        else await new Promise((done) => setTimeout(done, 10));
      }
    } finally {
      clearTimeout(deadline);
    }
  }

  /**
   * After a restart: a run that was running is marked interrupted and its task made resumable; a
   * run that never started is queued again. Call once, while this service owns the data root.
   */
  async recover(): Promise<{ requeued: number; interrupted: number }> {
    const counts = { requeued: 0, interrupted: 0 };
    for (const project of await this.projects.list()) {
      for (const task of await this.tasks.list(project.name).catch(() => [])) {
        const target = { project: project.name, id: task.id };
        const latest = await this.latest(target).catch(() => undefined);
        if (!latest || this.active.has(latest.record.id)) continue;
        const { record, dir } = latest;
        if (record.state !== 'queued' && record.state !== 'running') continue;
        await this.tasks.clearDeadLock(project.name, task.id);
        if (record.state === 'queued' && (await this.requeue(record, dir))) {
          counts.requeued++;
          continue;
        }
        counts.interrupted++;
        await this.storage.writeDocument(join(dir, 'run.json'), {
          ...record,
          state: 'interrupted',
          error:
            record.state === 'queued' ? 'The run could not be queued again after a restart.' : INTERRUPTED,
          finished_at: new Date().toISOString(),
        });
        const current = await this.tasks.read(project.name, task.id);
        if (['coding', 'reviewing'].includes(current.stage))
          await this.tasks.write(withStage(current, new Date().toISOString(), 'failed', INTERRUPTED));
      }
    }
    return counts;
  }

  private async requeue(record: RunRecord, dir: string): Promise<boolean> {
    if (!this.accepting) return false;
    this.reservations++;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await this.tasks.acquireLock(record.project, record.task_id);
      const task = await this.tasks.read(record.project, record.task_id);
      if (taskCommandBlockers(task, record.action).length) throw new Error('blocked');
      this.schedule(record.command, record, dir, release);
      return true;
    } catch {
      this.reservations--;
      await release?.();
      return false;
    }
  }
}
