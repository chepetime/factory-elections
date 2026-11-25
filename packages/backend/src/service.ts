import { execFile } from 'node:child_process';
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
  newSpanId,
  newTraceId,
  taskClass,
  UNUSUAL_LOOKBACK_MS,
  traceTree,
  inboxItems,
  type InboxItem,
  metricsSummary,
  type ModelRunner,
  type RepoProfile,
  type TaskControls,
  type TaskRecord,
  type TraceScope,
  CleanupRecord,
  cleanupBlocker,
  combineCleanup,
  errorCleanup,
  ExecutionOutcome,
  failureOutcome,
  parseModelRef,
  ProviderSessionRef,
  withSession,
  type CallCleanup,
  type ModelFailure,
  type ModelResult,
  CallManifest,
  taskSpend,
} from '@factory/core';
import { callManifest, saveTaskReceipt, withManifest } from './receipts.ts';
import { type ProjectStore, type TaskStore, readProfile } from '@factory/adapters-fs';
import type { Driver } from '@factory/driver';
import { composeDriver } from './compose.ts';
import { DelegationServer } from './delegation.ts';
import { MemoryService } from './memory.ts';
import { FeatureService } from './features.ts';
import { IssueService } from './issues.ts';
import { AgentService } from './agent-profiles.ts';
import { approveProfile, ensureProfileDraft, profileStatus } from './profile-draft.ts';
import { removeWorktree } from '@factory/adapters-git';
import { TraceLog } from './traces.ts';
import { ExperimentStore } from './experiments.ts';
import { PrReviewStore } from './pr-review-records.ts';
import { OutcomeStore } from './outcomes.ts';
import { TendingService } from './tending.ts';
import { storageFor, type DataStorage } from '@factory/adapters-data';
import { Evidence } from './evidence.ts';
import { Conflict } from './conflict.ts';
import { MAX_AGENTS, ReviewService, type ReviewDeps } from './reviews.ts';
import { ProjectSettingsService, type SettingsDetector } from './settings.ts';
export { Conflict };
import { TeamService } from './team.ts';
import { TicketService } from './tickets.ts';
import { environmentChecks, type Check } from './diagnostics.ts';
import type { BackgroundRun, Command, Target } from './protocol.ts';
import { RunActivity, trackShell } from './activity.ts';
import { ProfileChecks } from './profile-check.ts';

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
  /** How the run ended, apart from `state` (ADR 0005). Absent in older records: see runOutcome. */
  outcome: ExecutionOutcome.optional(),
  /** Whether the run's processes are known to be gone. Absent: not recorded. */
  cleanup: CleanupRecord.optional(),
  /** The provider sessions the run's model calls used, as references. */
  provider_sessions: z.array(ProviderSessionRef).optional(),
  /** What the run's model calls were given: one entry per distinct configuration (Phase 4). */
  manifests: z.array(CallManifest).optional(),
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
/** The commit a branch points at, or undefined when git cannot tell. */
const revParse = (repo: string, ref: string | undefined) =>
  new Promise<string | undefined>((done) => {
    if (!ref) return done(undefined);
    execFile('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], (error, stdout) =>
      done(error ? undefined : stdout.trim() || undefined),
    );
  });

/** When a task at the approval gate reached it: its latest gate input. */
const gateOpenedAt = (task: TaskRecord): string | undefined =>
  [task.pr_draft?.at, task.review?.at, task.verification?.at, task.updated_at]
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);

const INTERRUPTED =
  'The backend stopped during this run. Run the task again to continue from the last saved step.';

export class BackendService {
  readonly storage: DataStorage;
  readonly tasks: TaskStore;
  readonly team: TeamService;
  readonly profileChecks: ProfileChecks;
  readonly tickets: TicketService;
  readonly reviews: ReviewService;
  readonly settings: ProjectSettingsService;
  private readonly environment: () => Promise<Check[]>;
  readonly projects: ProjectStore;
  private readonly worker = Effect.runSync(Effect.makeSemaphore(taskWorkers()));
  private readonly active = new Map<string, Promise<void>>();
  /** Aborts each running run's model calls and checks, on shutdown after the grace period. */
  private readonly controllers = new Map<string, AbortController>();
  /** What each executing run is doing now: current command and last output. */
  private readonly activities = new Map<string, RunActivity>();
  /** Runs a person asked to stop; a queued one stops as soon as it starts. */
  private readonly stopRequests = new Set<string>();
  private executing = 0;
  private accepting = true;
  private reservations = 0;
  readonly root: string;
  private readonly runner?: ModelRunner;
  /** The `delegate` MCP server. Children take agent slots like any other agent. */
  readonly delegation: DelegationServer;
  /** What agents learn about each repository across sessions. */
  readonly memory: MemoryService;
  /** Grill → spec → board → implement → QA. */
  readonly features: FeatureService;
  readonly issues: IssueService;
  readonly agents: AgentService;
  /** One span ledger for every run, model call, tool call, child, review, feature step and gate. */
  readonly traces: TraceLog;
  readonly experiments: ExperimentStore;
  readonly prReviewRecords: PrReviewStore;
  readonly outcomes: OutcomeStore;
  /** Keeps open factory PRs moving, for projects that turn it on. */
  readonly tending: TendingService;
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
    this.profileChecks = new ProfileChecks({
      root,
      storage: this.storage,
      repo: async (project) => {
        const { repo } = await this.projects.read(project);
        const status = await profileStatus(root, project);
        if (status.state === 'missing') throw new Conflict('There is no repo profile. Draft one first.');
        if (status.state === 'draft') throw new Conflict('Approve the repo profile first.');
        if (status.state === 'invalid') throw new Conflict(`Fix the repo profile first: ${status.error}`);
        return repo;
      },
      driver: (log, signal) => this.driver(log, this.runner, signal),
    });
    this.environment = environment ?? (() => environmentChecks(root));
    this.runner = runner;
    this.tasks = this.storage.tasks;
    this.projects = this.storage.projects;
    this.settings = new ProjectSettingsService(root, this.storage, this.projects, detector);
    this.tickets = new TicketService(this.projects, (project) => this.settings.get(project));
    this.reviews = new ReviewService(
      root,
      this.projects,
      (p) => this.settings.get(p),
      reviewDeps,
      () => this.executing,
    );
    this.traces = new TraceLog(root, this.storage);
    this.experiments = new ExperimentStore(root, this.storage);
    this.prReviewRecords = new PrReviewStore(root, this.storage);
    this.outcomes = new OutcomeStore(root, this.storage);
    const base: ModelRunner = {
      run: (request) => (this.runner ?? composeDriver(this.root).deps.runner).run(request),
    };
    this.delegation = new DelegationServer({
      // Children of a traced call carry `traceParent`; other calls pass through untraced.
      runner: this.traces.runner(base, () => undefined),
      slot: () => this.tryAgentSlot(),
      traceParent: (token) => this.traces.grantParent(token),
    });
    this.reviews.delegation = this.delegation;
    this.memory = new MemoryService(
      root,
      (project) => this.traces.runner(base, () => ({ trace_id: newTraceId(), project }), 'memory-review'),
      (line) => process.stderr.write(`${line}\n`),
    );
    this.reviews.memory = this.memory;
    this.reviews.traces = this.traces;
    this.reviews.reviewRecords = this.prReviewRecords;
    this.features = new FeatureService({
      root,
      projects: this.projects,
      runner: (project, feature) =>
        this.memory.recording(
          project,
          'feature',
          // Each step is its own trace, joined to the others by the feature id.
          this.traces.runner(
            base,
            () => ({ trace_id: newTraceId(), project, feature_id: feature }),
            'feature-step',
          ),
        ),
      slot: () => this.tryAgentSlot(),
      settings: (p) => this.settings.get(p),
      facts: (p) => this.memory.prompt(p),
      tasks: this.tasks,
      startRun: (project, id) => this.start({ project, id, action: 'run' } as Command),
      reviewPr: (project, number) => this.reviews.start({ project, numbers: [number], mode: 'review' }),
      log: (line) => process.stderr.write(`${line}\n`),
    });
    this.agents = new AgentService({ root, storage: this.storage, seed: true });
    this.issues = new IssueService({
      agentName: async (id) => (await this.agents.active(id)).name,
      root,
      storage: this.storage,
      tasks: this.tasks,
      settings: (p) => this.settings.get(p),
      submit: (input) => this.submit(input),
      run: (project, id) => this.start({ project, id, action: 'run' } as Command),
      reject: (project, id, note) => this.execute({ project, id, action: 'reject', note } as Command),
      deleteRun: (project, id) => this.deleteRun(project, id),
    });
    this.tending = new TendingService({
      projects: this.projects,
      tasks: this.tasks,
      settings: (p) => this.settings.get(p),
      profile: (p) => readProfile(this.root, p),
      runner: (task) =>
        this.memory.recording(
          task.project,
          'tending',
          this.traces.runner(base, () => ({
            trace_id: newTraceId(),
            project: task.project,
            task_id: task.id,
            ...(task.pr ? { pr: { url: task.pr.url } } : {}),
            ...(taskClass(task.verdict) ? { task_class: taskClass(task.verdict) } : {}),
          })),
        ),
      slot: () => this.tryAgentSlot(),
      storage: this.storage,
      log: (line) => process.stderr.write(`${line}\n`),
    });
  }
  private inboxPath(): string {
    return join(this.root, 'inbox', 'dismissed.json');
  }
  private async dismissed(): Promise<Record<string, string>> {
    try {
      return (await this.storage.readDocument(this.inboxPath())) as Record<string, string>;
    } catch {
      return {};
    }
  }
  /** Everything that waits on the human, across projects, oldest first. */
  async inbox(): Promise<{ items: InboxItem[]; dismissed: number }> {
    const dismissed = await this.dismissed();
    const items: InboxItem[] = [];
    for (const { name } of await this.projects.list()) {
      const [tasks, features, reviews] = await Promise.all([
        this.tasks.list(name).catch(() => []),
        this.features.all(name).catch(() => []),
        this.reviews.waiting(name).catch(() => []),
      ]);
      const tending = await this.tending.waiting(name, tasks).catch(() => []);
      items.push(...inboxItems({ project: name, tasks, features, reviews, tending }));
    }
    const open = items.filter((i) => !dismissed[i.id]);
    return {
      items: open.sort((a, b) => a.since.localeCompare(b.since)),
      dismissed: items.length - open.length,
    };
  }
  /** Hides an inbox item until it waits again for a new reason. */
  async dismissInbox(raw: unknown): Promise<void> {
    const { id } = z.object({ id: z.string().min(1).max(400) }).parse(raw);
    if (!this.storage.config) await mkdir(join(this.root, 'inbox'), { recursive: true });
    await this.storage.writeDocument(this.inboxPath(), {
      ...(await this.dismissed()),
      [id]: new Date().toISOString(),
    });
  }
  /** Tends one task's PR now (or every tended PR), and lets a stopped PR be tended again. */
  async tendNow(raw: unknown) {
    const { project, id } = z
      .object({ project: ProjectName, id: z.union([TaskId, z.literal('')]) })
      .parse(raw);
    if (!id) {
      await this.tending.tick();
      return { tended: 'all' };
    }
    const task = await this.tasks.read(project, id);
    await this.tending.resume(task);
    // Asking for it by hand tends the PR even when the project's ticker is off.
    const settings = await this.settings.get(project);
    const action = await this.tending.tend(task, {
      ...settings,
      tending: { ...settings.tending, enabled: true },
    });
    return { action: action ?? null, record: (await this.tending.record(task)) ?? null };
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
    return composeDriver(this.root, log, runner, signal, this.delegation, {
      repositoryFacts: (project) => this.memory.prompt(project),
      contextLimits: async (project) => (await this.settings.get(project)).context_tokens,
    });
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
    const project = await this.projects.add(name, repo);
    // Every run needs an approved profile, so a new project starts with a draft to review.
    return { ...project, profile: await ensureProfileDraft(this.root, name, project.repo) };
  }
  /**
   * Deletes a run: its worktree and branch, then its records. The task lock is held throughout, so a
   * run or command in progress makes this fail. Traces and cost history in telemetry stay.
   */
  async deleteRun(project: string, id: string): Promise<void> {
    ProjectName.parse(project);
    TaskId.parse(id);
    if (!this.accepting) throw new Conflict('Backend is shutting down');
    await this.tasks.delete(project, id, async (task) => {
      if (!task.worktree) return;
      await removeWorktree(task.repo, task.worktree.path, task.worktree.branch).catch((error: unknown) => {
        // Best effort: the records go even if git refuses (a worktree already removed by hand).
        process.stderr.write(
          `deleteRun ${id}: worktree cleanup: ${error instanceof Error ? error.message : error}\n`,
        );
      });
    });
  }
  /** An agent's tasks across projects, its recent runs, and its last 30 days. */
  async agentStats(raw: unknown) {
    const agent = await this.agents.get(raw);
    const projects = await this.projects.list();
    const since = Date.now() - 30 * 86_400_000;
    const per = await Promise.all(
      projects.map(async ({ name }) => {
        const [board, tasks] = await Promise.all([this.issues.list(name), this.tasks.list(name)]);
        const owner = new Map(board.items.flatMap((i) => i.runs.map((r) => [r, i] as const)));
        return {
          work: board.items
            .filter((i) => i.assignee === agent.id && !i.archived_at)
            .map((i) => ({
              project: name,
              key: i.key,
              title: i.title,
              status: i.status,
              priority: i.priority,
              updated_at: i.updated_at,
            })),
          runs: tasks
            .filter((t) => t.agent === agent.id)
            .map((t) => ({
              project: name,
              id: t.id,
              stage: t.stage,
              created_at: t.created_at ?? '',
              updated_at: t.updated_at ?? t.created_at ?? '',
              cost_usd: taskSpend(t),
              key: owner.get(t.id)?.key,
              title: owner.get(t.id)?.title ?? t.name ?? t.prompt.split('\n')[0]!.slice(0, 100),
            })),
        };
      }),
    );
    const runs = per.flatMap((p) => p.runs).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const recent = runs.filter((r) => Date.parse(r.updated_at) > since);
    return {
      agent,
      work: per.flatMap((p) => p.work),
      running: runs.filter((r) => r.stage === 'coding' || r.stage === 'reviewing' || r.stage === 'queued'),
      runs: runs.slice(0, 10),
      last30: {
        runs: recent.length,
        completed: recent.filter(
          (r) => r.stage === 'awaiting-approval' || r.stage === 'approved' || r.stage === 'pr-opened',
        ).length,
        cost_usd: recent.reduce((sum, r) => sum + r.cost_usd, 0),
      },
    };
  }
  async profileStatus(raw: unknown) {
    const { project } = z.object({ project: ProjectName }).parse(raw);
    await this.projects.read(project);
    return profileStatus(this.root, project);
  }
  /** Drafts the project's profile if it has none, then returns its status. */
  async draftProfile(raw: unknown) {
    const { project } = z.object({ project: ProjectName }).parse(raw);
    const { repo } = await this.projects.read(project);
    const draft = await ensureProfileDraft(this.root, project, repo);
    if (draft.status === 'failed') throw new Conflict(`Could not draft the profile: ${draft.error}`);
    return profileStatus(this.root, project);
  }
  /** Approves a valid draft with today's local date. */
  async approveProfile(raw: unknown) {
    const { project } = z.object({ project: ProjectName }).parse(raw);
    await this.projects.read(project);
    return approveProfile(this.root, project, new Date().toLocaleDateString('en-CA')).catch(
      (error: unknown) => {
        throw new Conflict(error instanceof Error ? error.message : String(error));
      },
    );
  }
  async submit(raw: unknown): Promise<string> {
    const { project, prompt, jiraKey } = z
      .object({
        project: ProjectName,
        prompt: z.string().trim().min(1).max(100_000),
        jiraKey: z.string().trim().max(100).optional(),
      })
      .parse(raw);
    if (!this.accepting) throw new Conflict('Backend is shutting down');
    const registered = await this.projects.read(project);
    return (await this.tasks.create(project, registered.repo, prompt, new Date().toISOString(), jiraKey)).id;
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
      const before = await this.tasks.read(command.project, command.id).catch(() => undefined);
      const dir = join(dirname(this.tasks.taskPath(command.project, command.id)), 'runs', randomUUID());
      if (!this.storage.config) await mkdir(dir, { recursive: true });
      const evidence = new Evidence(join(dir, 'events.jsonl'), dir.split('/').at(-1)!, this.storage);
      try {
        return await evidence
          .span(`task.${command.action}`, { project: command.project, task_id: command.id }, () =>
            this.perform(
              command,
              this.driver((line) => evidence.record('log', { message: line })),
            ),
          )
          .then(async (result) => {
            if (command.action === 'open-pr')
              await this.tracePr(command.project, command.id).catch(() => undefined);
            if (command.action === 'approve' || command.action === 'open-pr')
              await this.issueReceipt(command.project, command.id).catch(() => undefined);
            if (before && ['approve', 'reject'].includes(command.action))
              await this.traceGate(before, command.action === 'approve' ? 'approved' : 'rejected').catch(
                () => undefined,
              );
            return result;
          });
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
      // A run that may have left processes behind blocks the next one on the same worktree.
      const waiting = cleanupBlocker((await this.latest(command))?.record.cleanup);
      if (waiting) throw new Conflict(waiting);
      if (command.action === 'revise') await this.traceGate(task, 'revise').catch(() => undefined);
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
      const work = Effect.tryPromise({
        try: () => this.work(command, record, dir),
        catch: (error) => error,
      }).pipe(
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
    if (this.stopRequests.has(record.id)) controller.abort();
    const activity = new RunActivity();
    this.activities.set(record.id, activity);
    let evidence: Evidence | undefined;
    // Cleanup evidence and session references from the run's model calls (ADR 0005).
    const calls: CallCleanup[] = [];
    let sessions: ProviderSessionRef[] = [];
    let manifests: CallManifest[] = [];
    const trace = await this.traceStart(command.project, command.id).catch(() => undefined);
    try {
      evidence = new Evidence(join(dir, 'events.jsonl'), record.id, this.storage);
      record.state = 'running';
      await this.storage.writeDocument(join(dir, 'run.json'), record);
      const sink = evidence;
      let logFailure: unknown;
      const log = (message: string) => {
        activity.heard();
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
          const ledger = trace ? this.traces.runner(base, () => trace.scope) : base;
          const traced = this.memory.recording(command.project, record.id, sink.runner(ledger, span));
          const checked: ModelRunner = {
            async run(request) {
              if (logFailure) throw logFailure;
              manifests = withManifest(manifests, callManifest(request));
              let result: ModelResult;
              try {
                result = await traced.run(request);
              } catch (error) {
                const cleanup = errorCleanup(error);
                if (cleanup) calls.push(cleanup);
                throw error;
              }
              if (result.sessionId)
                sessions = withSession(sessions, {
                  provider: parseModelRef(request.model).provider,
                  native_id: result.sessionId,
                  ...(request.cwd ? { cwd: request.cwd } : {}),
                  scope: request.persistSession || request.resume ? 'task' : 'disposable',
                  ...(request.step ? { step: request.step } : {}),
                  last_used_at: new Date().toISOString(),
                });
              // Later spans of the run carry the class the classifier just gave the task.
              if (trace && request.step === 'classifier')
                trace.scope.task_class =
                  taskClass(result.structured as { kind?: string; loe?: string }) ?? trace.scope.task_class;
              return result;
            },
          };
          const driver = this.driver(log, checked, controller.signal);
          driver.deps.shell = trackShell(driver.deps.shell, activity);
          await this.perform(command, driver);
          if (logFailure) throw logFailure;
        },
      );
      record.state = 'completed';
      record.outcome = 'completed';
    } catch (error) {
      record.state = 'failed';
      const stopped = this.stopRequests.has(record.id);
      record.outcome = failureOutcome((error as { kind?: ModelFailure } | null)?.kind, stopped);
      record.error = stopped
        ? 'Stopped by you before the run finished.'
        : error instanceof Error
          ? error.message
          : String(error);
      // A worker error must not leave the UI thinking an owned run is still coding.
      const task = await this.tasks.read(command.project, command.id);
      if (stopped || ['coding', 'reviewing'].includes(task.stage))
        await this.tasks.write(withStage(task, new Date().toISOString(), 'failed', record.error));
    } finally {
      this.controllers.delete(record.id);
      this.activities.delete(record.id);
      this.stopRequests.delete(record.id);
      this.executing--;
      record.finished_at = new Date().toISOString();
      record.cleanup = combineCleanup(calls);
      if (sessions.length) record.provider_sessions = sessions;
      if (manifests.length) record.manifests = manifests;
      if (trace) await this.traceEnd(trace, command.action, record).catch(() => undefined);
      try {
        try {
          await this.storage.writeDocument(join(dir, 'run.json'), record);
          // The receipt reads this run's manifests, so it follows the run record.
          await this.issueReceipt(command.project, command.id).catch(() => undefined);
        } finally {
          await evidence?.close();
        }
      } catch (error) {
        // Evidence durability is part of completion, even if the workflow itself succeeded.
        record.state = 'failed';
        record.outcome = 'failed';
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
  /** The trace of one task run: its root span id and the fields its spans share. */
  private async traceStart(project: string, id: string) {
    const task = await this.tasks.read(project, id);
    const profile = await readProfile(this.root, project).catch(() => undefined);
    const base_branch = task.worktree?.base_branch ?? task.stack_on ?? profile?.repo.base_branch.value;
    const runSpan = newSpanId();
    const scope: TraceScope = {
      trace_id: newTraceId(),
      project,
      task_id: id,
      parent_span_id: runSpan,
      ...(await this.traceLinks(task)),
    };
    return {
      scope,
      runSpan,
      started: Date.now(),
      task,
      profile,
      base_branch,
      base_sha: await revParse(task.worktree?.path ?? task.repo, base_branch),
    };
  }
  /** The ticket, feature, PR and class a task's spans carry. */
  private async traceLinks(task: TaskRecord): Promise<Partial<TraceScope>> {
    const feature = task.ticket
      ? await this.features.read(task.project, task.ticket.feature).catch(() => undefined)
      : undefined;
    const key = feature?.tickets.find((t) => t.id === task.ticket?.id)?.external?.key;
    const number = task.pr ? Number(/\/pull\/(\d+)/.exec(task.pr.url)?.[1]) : NaN;
    const cls = taskClass(task.verdict);
    return {
      ...(task.ticket
        ? { feature_id: task.ticket.feature, ticket: { id: task.ticket.id, ...(key ? { key } : {}) } }
        : task.jira_key
          ? { ticket: { key: task.jira_key } }
          : {}),
      ...(task.pr ? { pr: { url: task.pr.url, ...(Number.isFinite(number) ? { number } : {}) } } : {}),
      ...(cls ? { task_class: cls } : {}),
    };
  }
  /** Writes the run's root span, with the inputs needed to replay it. */
  private async traceEnd(
    trace: NonNullable<Awaited<ReturnType<BackendService['traceStart']>>>,
    action: string,
    record: RunRecord,
  ): Promise<void> {
    const task = await this.tasks.read(trace.scope.project, trace.scope.task_id!).catch(() => trace.task);
    const commands: RepoProfile['commands'] | undefined = trace.profile?.commands;
    const { parent_span_id: _, ...shared } = trace.scope;
    this.traces.append(
      {
        ...shared,
        ...(await this.traceLinks(task)),
        task_class: taskClass(task.verdict) ?? trace.scope.task_class,
      },
      {
        span_id: trace.runSpan,
        type: 'run',
        name: `task.${action}`,
        started_at: new Date(trace.started).toISOString(),
        ended_at: new Date().toISOString(),
        duration_ms: Date.now() - trace.started,
        outcome: record.state === 'completed' ? 'completed' : 'failed',
        ...(record.error ? { error: record.error } : {}),
        replay: {
          repo: task.repo,
          ...(trace.base_branch ? { base_branch: trace.base_branch } : {}),
          ...(trace.base_sha ? { base_sha: trace.base_sha } : {}),
          prompt: task.prompt,
          verification: commands
            ? [commands.test, commands.full_check, commands.runtime_check].filter((c): c is string => !!c)
            : [],
        },
        attributes: { run_id: record.id, stage: task.stage, attempts: task.attempts?.length ?? 0 },
      },
    );
    await this.traces.flush();
  }
  /**
   * Saves the evidence receipt of the task's newest commit with evidence: the PR head, the
   * approved commit, or the verified commit. A task without any of them gets no receipt.
   */
  async issueReceipt(project: string, id: string) {
    const task = await this.tasks.read(project, id);
    const head = task.pr?.head_sha ?? task.approval?.head_sha ?? task.verification?.head_sha;
    if (!head) return undefined;
    return saveTaskReceipt(this.root, this.storage, project, id, head);
  }
  /** Marks the moment a task's PR opened, so the task's traces join to the PR. */
  private async tracePr(project: string, id: string): Promise<void> {
    const task = await this.tasks.read(project, id);
    if (!task.pr) return;
    const at = new Date().toISOString();
    this.traces.append(
      { trace_id: newTraceId(), project, task_id: id, ...(await this.traceLinks(task)) },
      { type: 'pr', name: 'PR opened', started_at: at, ended_at: at, duration_ms: 0, outcome: 'completed' },
    );
    await this.traces.flush();
  }
  /** Spans of one task, trace or feature, as trees with rolled-up cost. */
  async trace(raw: unknown) {
    const q = z
      .object({
        project: ProjectName,
        task_id: z.string().max(100).optional(),
        trace_id: z.string().max(100).optional(),
        feature_id: z.string().max(100).optional(),
      })
      .refine((x) => x.task_id || x.trace_id || x.feature_id, 'Name a task_id, trace_id or feature_id')
      .parse(raw);
    const { project, ...filter } = q;
    const spans = await this.traces.read(project, filter);
    return { spans: spans.length, roots: traceTree(spans) };
  }
  /** Counts across runs for one project, or every project, over `[from, to)` (default: 7 days). */
  async metrics(raw: unknown) {
    const q = z
      .object({
        project: z.union([ProjectName, z.literal('')]).optional(),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
      })
      .parse(raw);
    const to = q.to ?? new Date(Date.now() + 1000).toISOString();
    const from = q.from ?? new Date(Date.parse(to) - 7 * 86_400_000).toISOString();
    const projects = q.project ? [q.project] : (await this.projects.list()).map((p) => p.name);
    const historyStart = new Date(Date.parse(from) - UNUSUAL_LOOKBACK_MS).toISOString();
    const spans = (
      await Promise.all(projects.map((p) => this.traces.read(p, { since: historyStart })))
    ).flat();
    return metricsSummary(spans, from, to);
  }
  /** The time a task waited at the approval gate, as a span, when the human acts on it. */
  private async traceGate(task: TaskRecord, decision: string): Promise<void> {
    if (task.stage !== 'awaiting-approval') return;
    const opened = gateOpenedAt(task);
    const ended = new Date().toISOString();
    this.traces.append(
      { trace_id: newTraceId(), project: task.project, task_id: task.id, ...(await this.traceLinks(task)) },
      {
        type: 'gate',
        name: 'approval gate',
        started_at: opened ?? ended,
        ended_at: ended,
        ...(opened ? { duration_ms: Math.max(0, Date.parse(ended) - Date.parse(opened)) } : {}),
        outcome: 'completed',
        attributes: { decision },
      },
    );
    await this.traces.flush();
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
      ...(running && this.activities.has(record.id)
        ? { activity: this.activities.get(record.id)!.snapshot() }
        : {}),
      ...(record.cleanup ? { cleanup: record.cleanup } : {}),
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
    let cleanup: CleanupRecord | undefined;
    try {
      const run = await this.background(target, false);
      execution = run.phase ?? 'unavailable';
      cleanup = run.cleanup;
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
      actions: taskActions(task, execution, head_sha, cleanup),
    };
  }
  /** Stops the task's active run: its model calls and commands get the abort signal. */
  async stopRun(target: Target): Promise<string> {
    const latest = await this.latest(target);
    if (!latest || !this.active.has(latest.record.id)) throw new Conflict('No run is active for this task.');
    this.stopRequests.add(latest.record.id);
    const controller = this.controllers.get(latest.record.id);
    if (!controller) return 'Stopping the run before it starts.';
    controller.abort();
    return 'Stopping the run.';
  }
  /**
   * Records that a person checked an uncertain cleanup: nothing from the last run still runs.
   * New runs on the task may start again. The reasons stay on the record.
   */
  async confirmCleanup(target: Target): Promise<string> {
    const { project, id } = this.target(target);
    // An active run holds the task lock for its whole life: refuse before waiting on the lock.
    const current = await this.latest(target);
    if (current && this.active.has(current.record.id)) throw new Conflict('A run still owns this task.');
    return this.tasks.withLock(project, id, async () => {
      const latest = await this.latest(target);
      if (!latest || !cleanupBlocker(latest.record.cleanup))
        throw new Conflict('The last run has no uncertain cleanup to confirm.');
      await this.storage.writeDocument(join(latest.dir, 'run.json'), {
        ...latest.record,
        cleanup: { ...latest.record.cleanup!, confirmed_at: new Date().toISOString() },
      });
      return 'Cleanup confirmed; the task can run again.';
    });
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
  /** Takes a free agent slot at once, for a child task; undefined when none is free. */
  private async tryAgentSlot(): Promise<(() => void) | undefined> {
    if (!this.accepting) return undefined;
    const reviews = await this.reviews.agentsInUse().catch(() => 0);
    if (!this.accepting || this.executing + reviews >= MAX_AGENTS) return undefined;
    this.executing++;
    let released = false;
    return () => {
      if (!released) this.executing--;
      released = true;
    };
  }
  async drain(graceMs = DRAIN_GRACE_MS): Promise<void> {
    this.accepting = false;
    this.profileChecks.stopAll();
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
          outcome: 'interrupted',
          // Processes of a run that was running at a crash are not known to be gone.
          ...(record.state === 'running'
            ? { cleanup: { status: 'uncertain', reasons: ['the backend stopped while the run was running'] } }
            : {}),
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
