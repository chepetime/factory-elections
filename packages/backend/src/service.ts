import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  ProjectName,
  TaskId,
  executionPhase,
  runWorking,
  taskActions,
  taskCommandBlockers,
  withStage,
  newTraceId,
  taskClass,
  inboxItems,
  type InboxItem,
  type ModelRunner,
  type TaskControls,
  type TaskRecord,
  CleanupRecord,
  cleanupBlocker,
  failureOutcome,
  taskSpend,
  envNames,
  type QueueWait,
  recoveryBlocker,
  prBody,
  conflictFollowUpNote,
  recoveryInboxItems,
  type RecoveryProblem,
  type RecoveryReport,
} from '@factory/core';
import { Evidence, ExperimentStore, OutcomeStore, saveTaskReceipt, TraceLog } from '@factory/evidence';
import { type ProjectStore, type TaskStore, readProfile } from '@factory/adapters-fs';
import { readPrTemplate, type Driver } from '@factory/driver';
import { editPullRequestBody, markPullRequestReady, pullRequestIsDraft } from '@factory/adapters-github';
import { ReviewLoop } from './review-loop.ts';
import { composeDriver } from '@factory/compose';
import {
  DelegationServer,
  MemoryService,
  AgentService,
  availableSkills,
  buildAgentSession,
  ChatService,
  AgentPickup,
  routeTask,
  type SessionEntry,
} from '@factory/agents';
import { FeatureService } from './features.ts';
import { IssueService } from './issues.ts';
import { approveProfile, ensureProfileDraft, profileStatus } from './profile-draft.ts';
import { removeWorktree } from '@factory/adapters-git';
import { TendingService } from './tending.ts';
import { storageFor, type DataStorage } from '@factory/adapters-data';
import { Conflict } from './conflict.ts';
import { PrReviewStore, ReviewService, type ReviewDeps } from '@factory/pr-reviews';
import { run } from '@factory/adapters-process';
import { systemCatalog } from './system-catalog.ts';
import { ReviewTickets } from './review-tickets.ts';
import { AgentPool, Dispatcher, Executions, MAX_AGENTS, type Release } from '@factory/dispatcher';
import { ProjectSettingsService, type SettingsDetector } from './settings.ts';
import { UserSettingsService } from './user-settings.ts';
export { Conflict };
import { TeamService } from './team.ts';
import { TicketService } from './tickets.ts';
import { environmentChecks, type Check } from '@factory/compose/diagnostics';
import type { BackgroundRun, Command, Target } from '@factory/backend-client/protocol';
import { ProfileChecks } from './profile-check.ts';
import { TaskTraces } from './task-traces.ts';
import { CommandSchema, RunRecord, TargetSchema, type RunCommand } from './run-record.ts';
import { performCommand, RunExecutor } from './run-executor.ts';

/**
 * Task runs that may execute at once. Each has its own worktree; the git adapter serializes the
 * commands that change a repository's shared refs. Reviews and task runs together stay within
 * MAX_AGENTS: a run waits in `queued` while the agents in use fill it.
 */
export const taskWorkers = () => Math.max(1, Number(process.env.FACTORY_TASK_WORKERS ?? 3) || 1);
/** How long shutdown waits for the active runs before it stops them. */
export const DRAIN_GRACE_MS = Number(process.env.FACTORY_DRAIN_GRACE_MS ?? 5 * 60_000);
/** How often recovery retries what it could not read. */
const RECOVERY_RETRY_MS = Number(process.env.FACTORY_RECOVERY_RETRY_MS ?? 30_000);
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
  readonly user: UserSettingsService;
  private readonly environment: () => Promise<Check[]>;
  readonly projects: ProjectStore;
  /** Every agent this backend runs takes a slot here; reviews count from outside. */
  readonly pool: AgentPool;
  /** The task run queue. */
  private readonly dispatcher: Dispatcher;
  /** Senior-pr-review rounds on agents' draft PRs (review-loop.ts). */
  readonly reviewLoop: ReviewLoop;
  /** Someone's PR as a review ticket: rounds, your decision, posting, re-review on new commits. */
  readonly reviewTickets: ReviewTickets;
  /** Background executions other than task runs: feature steps. */
  readonly executions: Executions;
  /** Span ledger entries for runs, PRs and the approval gate, and the queries over them. */
  private readonly taskTraces: TaskTraces;
  /** Executes accepted runs and holds what is live about each one. */
  private readonly executor: RunExecutor;
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
  readonly chats: ChatService;
  /** Starts Todo tasks assigned to free agents. The server starts it; tests call `tick`. */
  readonly pickup: AgentPickup;
  /** What the run's steps are, for the progress line: an agent run has no classifier or reviewer. */
  private async runLabel(task: TaskRecord, action: string, agent?: string): Promise<string> {
    if (action === 'follow-up' || task.workflow === 'agent') {
      const id = (action === 'follow-up' && agent) || task.agent;
      const name = id ? ((await this.agents.get({ id }).catch(() => undefined))?.name ?? id) : 'Agent';
      if (action === 'follow-up') return `${name}: follow-up on the open PR → commit → checks`;
      return action === 'run'
        ? `${name}: session → commit → checks`
        : `${name} read your reply: session → commit → checks`;
    }
    return action === 'run'
      ? 'Running classify → code → verify → review'
      : 'Revising: code → verify → review';
  }
  /** A task's session: every agent message, tool call and result of its runs, live while one works. */
  async runSession(raw: unknown): Promise<{ entries: SessionEntry[]; live: boolean }> {
    const { project, id } = z.object({ project: ProjectName, id: TaskId }).parse(raw);
    return this.executor.session(project, id);
  }
  /** Why a turn queued for the task has not started; undefined when none waits. */
  isWaiting(project: string, id: string): QueueWait | undefined {
    return this.dispatcher.waiting(`${project}/${id}`);
  }
  /** Whether this backend has a run queued or working for the task. */
  isScheduled(project: string, id: string): boolean {
    return this.dispatcher.scheduledFor(`${project}/${id}`);
  }
  /** Why a run cannot start in this project now, in words a person can act on; undefined when it can. */
  async runBlocker(project: string): Promise<string | undefined> {
    const status = await profileStatus(this.root, project);
    if (status.state === 'missing')
      return 'There is no repo profile. Open Project settings, Setup check, and draft one.';
    if (status.state === 'draft')
      return 'The repo profile is not approved. Open Project settings, Setup check, and approve it.';
    if (status.state === 'invalid')
      return `The repo profile is invalid: ${status.error}. Fix it in ${status.path}.`;
    return undefined;
  }
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
    // Reviews read their state from storage; the pool caches that count for all its waiters.
    this.pool = new AgentPool({ max: MAX_AGENTS, external: () => this.reviews.agentsInUse() });
    this.dispatcher = new Dispatcher({ workers: taskWorkers(), pool: this.pool });
    this.executions = new Executions({ pool: this.pool });
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
    this.user = new UserSettingsService(root, this.storage, { projects: () => this.projects.list() });
    this.tickets = new TicketService(this.projects, (project) => this.settings.get(project));
    this.reviews = new ReviewService(
      root,
      this.projects,
      (p) => this.settings.get(p),
      reviewDeps,
      () => this.pool.inUse(),
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
      slot: () => this.pool.tryAcquire(),
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
    this.chats = new ChatService({
      root,
      storage: this.storage,
      agent: (id) => this.agents.get({ id }),
      projects: () => this.projects.list(),
      issues: {
        create: (r) => this.issues.create(r),
        update: (r) => this.issues.update(r),
        list: (p) => this.issues.list(p),
      },
      runner: (project) =>
        project ? this.traces.runner(base, () => ({ trace_id: newTraceId(), project }), 'chat') : base,
      executions: this.executions,
      delegation: this.delegation,
    });
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
      executions: this.executions,
      settings: (p) => this.settings.get(p),
      facts: (p) => this.memory.prompt(p),
      tasks: this.tasks,
      startRun: (project, id) => this.start({ project, id, action: 'run' } as Command),
      closeRun: (project, id, note) =>
        this.isScheduled(project, id)
          ? this.stopRun({ project, id })
          : this.execute({ project, id, action: 'reject', note } as Command),
      reviewPr: (project, number) => this.reviews.start({ project, numbers: [number], mode: 'review' }),
      log: (line) => process.stderr.write(`${line}\n`),
    });
    this.taskTraces = new TaskTraces({
      root,
      tasks: this.tasks,
      traces: this.traces,
      features: this.features,
      projects: this.projects,
    });
    this.executor = new RunExecutor({
      storage: this.storage,
      tasks: this.tasks,
      traces: this.traces,
      taskTraces: this.taskTraces,
      memory: this.memory,
      user: this.user,
      runner: (log) => this.runner ?? composeDriver(this.root, log).deps.runner,
      driver: (log, runner, signal) => this.driver(log, runner, signal),
      stopRequested: (runId) => this.dispatcher.stopRequested(runId),
      receipt: (project, id) => this.issueReceipt(project, id),
      kick: () => this.pickup?.kick(),
    });
    this.agents = new AgentService({ root, storage: this.storage, seed: true });
    this.issues = new IssueService({
      agentName: async (id) => (await this.agents.active(id)).name,
      agentIds: async () => (await this.agents.list()).filter((a) => !a.archived_at).map((a) => a.id),
      startReview: (project, key) => this.reviewTickets.start(project, key),
      changed: () => this.pickup?.kick(),
      waiting: (project, id) => this.isWaiting(project, id),
      root,
      storage: this.storage,
      tasks: this.tasks,
      owned: (p, id) => this.isScheduled(p, id),
      settings: (p) => this.settings.get(p),
      submit: (input) => this.submit(input),
      revise: (project, id, note) => this.start({ project, id, action: 'revise', note } as Command),
      followUp: (project, id, input) =>
        this.start({
          project,
          id,
          action: 'follow-up',
          note: input.note,
          kind: input.kind,
          agent: input.agent,
          by: input.by ?? 'you',
          pr_head: input.prHead ?? '',
        } as Command),
      run: (project, id, reply) =>
        this.start({ project, id, action: 'run', ...(reply ? { note: reply } : {}) } as Command),
      reject: (project, id, note) => this.execute({ project, id, action: 'reject', note } as Command),
      cancelQueued: (project, id) => this.cancelQueued(project, id),
      deleteRun: (project, id) => this.deleteRun(project, id),
    });
    this.pickup = new AgentPickup({
      agents: () => this.agents.list(),
      projects: () => this.projects.list(),
      issues: this.issues,
      tasks: (p) => this.tasks.list(p),
      scheduled: (p, id) => this.isScheduled(p, id),
      blocker: (p) => this.runBlocker(p),
      route: async (task) => {
        const base = this.runner ?? composeDriver(this.root).deps.runner;
        const runner = this.traces.runner(
          base,
          () => ({ trace_id: newTraceId(), project: task.project }),
          'model',
        );
        return routeTask({ task, agents: await this.agents.list(), runner });
      },
      accepting: () => this.dispatcher.accepting,
      log: (line) => process.stderr.write(`${line}\n`),
    });
    this.reviewLoop = new ReviewLoop({
      tasks: this.tasks,
      storage: this.storage,
      startReview: async (project, number) => {
        const [result] = await this.reviews.start({ project, numbers: [number], mode: 'review' });
        if (!result?.ok) throw new Error(result?.error ?? 'the review was refused');
      },
      followUp: (project, id, note) =>
        this.issues.followUp({ project, key: id, note, kind: 'review', by: 'factory' }),
      note: (project, id, message) => this.issues.note({ project, key: id, kind: 'review-loop', message }),
      body: async (task) => prBody(task, task.pr!.head_sha, (await readPrTemplate(task.worktree!.path)).text),
      github: { markReady: markPullRequestReady, editBody: editPullRequestBody, isDraft: pullRequestIsDraft },
      log: (line) => process.stderr.write(`${line}\n`),
    });
    this.reviewTickets = new ReviewTickets({
      projects: this.projects,
      issues: this.issues,
      reviews: this.reviews,
      github: {
        pr: async (project, number) => {
          const { repo } = await this.projects.read(project);
          const out = await run(
            'gh',
            ['pr', 'view', String(number), '--json', 'state,headRefOid,title,url,author'],
            { cwd: repo, timeoutMs: 60_000 },
          );
          if (out.code !== 0)
            throw new Error(`gh pr view ${number} failed: ${(out.stderr || out.stdout).trim()}`);
          const v = JSON.parse(out.stdout) as {
            state: 'OPEN' | 'MERGED' | 'CLOSED';
            headRefOid: string;
            title: string;
            url: string;
            author?: { login?: string };
          };
          return {
            state: v.state,
            head_sha: v.headRefOid,
            title: v.title,
            url: v.url,
            author: v.author?.login ?? 'unknown',
          };
        },
      },
      log: (line) => process.stderr.write(`${line}\n`),
    });
    this.reviews.onTurnEnded = (project, number, turn) => this.reviewTickets.turnEnded(project, number, turn);
    this.reviews.onReviewEnded = (project, number, payload, reason) =>
      this.reviewLoop.reviewEnded(project, number, payload, reason);
    this.tending = new TendingService({
      prObserved: async (task, pr) => {
        await this.issues.prOutcome(task.project, task.id, pr);
        // An agent's draft PR that never got a review loop (it opened before the loop existed, or
        // the backend was down): start one. The loop ignores a PR it already has a state for.
        if (pr.state === 'OPEN' && pr.draft && task.workflow === 'agent')
          await this.reviewLoop.prChanged(task, { kind: 'opened', draft: true });
        // A loop whose review a restart cut waits for a result that never comes: start it again.
        if (pr.state === 'OPEN' && task.workflow === 'agent') {
          const loop = await this.reviewLoop.state(task);
          if (loop?.state === 'reviewing' && loop.pr === pr.number) {
            const review = await this.reviews
              .detail({ project: task.project, number: pr.number })
              .catch(() => undefined);
            if (review?.state === 'interrupted') await this.reviewLoop.resumeInterrupted(task);
          }
        }
      },
      conflictFollowUp: (task, pr) =>
        this.issues.followUp({
          project: task.project,
          key: task.id,
          note: conflictFollowUpNote(pr.base),
          kind: 'conflicts',
          by: 'factory',
          pr_head: pr.head_sha,
        }),
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
      slot: () => this.pool.tryAcquire(),
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
    items.push(...recoveryInboxItems(this.recovery));
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
      agentSession: async (task, reply) => {
        if (!task.agent) throw new Conflict('This run has no agent.');
        const profile = await readProfile(this.root, task.project);
        return buildAgentSession({
          task,
          ...(reply ? { reply } : {}),
          agent: await this.agents.active(task.agent),
          issues: this.issues,
          profile: {
            test: profile.commands.test,
            full_check: profile.commands.full_check,
            forbidden_paths: profile.confirmed.forbidden_paths,
          },
          allowedEnv: process.env.FACTORY_AGENT_ENV_ALLOW,
        });
      },
    });
  }
  /** Projects with their display name, icon and picked accent from settings. */
  async projectSummaries() {
    const projects = await this.projects.list();
    return Promise.all(
      projects.map(async (p) => {
        const s = await this.settings.get(p.name).catch(() => undefined);
        return { ...p, display_name: s?.display_name, icon: s?.icon, accent: s?.accent || undefined };
      }),
    );
  }
  /** Registers a repository. The store checks that the path is an existing absolute directory. */
  async addProject(raw: unknown) {
    const { name, repo } = z
      .object({ name: ProjectName, repo: z.string().trim().min(1).max(4096) })
      .parse(raw);
    if (!this.dispatcher.accepting) throw new Conflict('Backend is shutting down');
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
    if (!this.dispatcher.accepting) throw new Conflict('Backend is shutting down');
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
      skills_available: await availableSkills(),
      /** Env names the operator lets agents pass; names only, never values. */
      env_allowed: envNames(process.env.FACTORY_AGENT_ENV_ALLOW),
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
    const { project, prompt, jiraKey, agent } = z
      .object({
        project: ProjectName,
        prompt: z.string().trim().min(1).max(100_000),
        jiraKey: z.string().trim().max(100).optional(),
        /** A workspace agent: the run is one session by that agent instead of the pipeline. */
        agent: z.string().min(1).optional(),
      })
      .parse(raw);
    if (!this.dispatcher.accepting) throw new Conflict('Backend is shutting down');
    if (agent) {
      await this.agents.active(agent);
      // Refuse before a run record exists, so a refused start leaves no empty run behind.
      const blocked = await this.runBlocker(project);
      if (blocked) throw new Conflict(blocked);
    }
    const registered = await this.projects.read(project);
    const task = await this.tasks.create(project, registered.repo, prompt, new Date().toISOString(), jiraKey);
    if (agent) await this.tasks.write({ ...task, workflow: 'agent', agent });
    return task.id;
  }
  private command(raw: Command) {
    const command = CommandSchema.parse(raw);
    if (['revise', 'reject', 'follow-up'].includes(command.action) && !command.note.trim())
      throw new Error('A note is required');
    return command;
  }
  async execute(raw: Command): Promise<string> {
    const command = this.command(raw);
    if (['run', 'revise', 'follow-up'].includes(command.action))
      throw new Error('Use StartRun for long-running work');
    if (!this.dispatcher.accepting) throw new Conflict('Backend is shutting down');
    const unknown = recoveryBlocker(this.recovery, command.project, command.id);
    if (unknown) throw new Conflict(unknown);
    return this.tasks.withLock(command.project, command.id, async () => {
      const before = await this.tasks.read(command.project, command.id).catch(() => undefined);
      const dir = join(dirname(this.tasks.taskPath(command.project, command.id)), 'runs', randomUUID());
      if (!this.storage.config) await mkdir(dir, { recursive: true });
      const evidence = new Evidence(join(dir, 'events.jsonl'), dir.split('/').at(-1)!, this.storage);
      try {
        return await evidence
          .span(`task.${command.action}`, { project: command.project, task_id: command.id }, () =>
            performCommand(
              command,
              this.driver((line) => evidence.record('log', { message: line })),
            ),
          )
          .then(async (result) => {
            if (command.action === 'open-pr') {
              await this.taskTraces.pr(command.project, command.id).catch(() => undefined);
              // An agent's draft PR, or a follow-up pushed to its open PR, starts a review cycle. It
              // runs on after this command returns.
              const opened = await this.tasks.read(command.project, command.id);
              void this.reviewLoop
                .prChanged(
                  opened,
                  before?.pr ? { kind: 'updated' } : { kind: 'opened', draft: command.draft },
                )
                .catch((error: unknown) => process.stderr.write(`review loop: ${String(error)}\n`));
            }
            if (command.action === 'approve' || command.action === 'open-pr')
              await this.issueReceipt(command.project, command.id).catch(() => undefined);
            if (before && ['approve', 'reject'].includes(command.action))
              await this.taskTraces
                .gate(before, command.action === 'approve' ? 'approved' : 'rejected')
                .catch(() => undefined);
            return result;
          });
      } finally {
        await evidence.close();
      }
    });
  }
  async start(raw: Command): Promise<RunRecord> {
    const command = this.command(raw);
    if (!['run', 'revise', 'follow-up'].includes(command.action))
      throw new Error('Only run, revise and follow-up can be scheduled');
    if (command.action === 'follow-up' && !command.agent)
      throw new Conflict('Name the agent for the follow-up.');
    const unknown = recoveryBlocker(this.recovery, command.project, command.id);
    if (unknown) throw new Conflict(unknown);
    const reservation = this.dispatcher.reserve();
    if (!reservation) throw new Conflict('Backend is stopping or its queue is full');
    let release: (() => Promise<void>) | undefined;
    try {
      release = await this.tasks.acquireLock(command.project, command.id);
      const task = await this.tasks.read(command.project, command.id);
      const blockers = taskCommandBlockers(task, command.action);
      if (blockers.length) throw new Conflict(blockers.map((b) => b.message).join('; '));
      // A run that may have left processes behind blocks the next one on the same worktree.
      const waiting = cleanupBlocker((await this.latest(command))?.record.cleanup);
      if (waiting) throw new Conflict(waiting);
      if (command.action === 'revise') await this.taskTraces.gate(task, 'revise').catch(() => undefined);
      const blocked = await this.runBlocker(command.project);
      if (blocked) throw new Conflict(blocked);
      await readProfile(this.root, command.project);
      const record: RunRecord = {
        id: randomUUID(),
        project: command.project,
        task_id: command.id,
        action: command.action,
        command,
        label: await this.runLabel(task, command.action, command.agent),
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
      this.schedule(command, record, dir, release, reservation);
      return record;
    } catch (error) {
      reservation();
      await release?.();
      throw error;
    }
  }
  /** Queues an accepted run on the dispatcher. It takes over the reservation and the task lock. */
  private schedule(
    command: RunCommand,
    record: RunRecord,
    dir: string,
    unlock: () => Promise<void>,
    reservation: Release,
  ): void {
    this.dispatcher.schedule(
      {
        task: `${command.project}/${command.id}`,
        run: record.id,
        agent: async () => {
          const task = await this.tasks.read(command.project, command.id).catch(() => undefined);
          // A follow-up runs as its named agent, also on a task the pipeline did.
          const name =
            command.action === 'follow-up' && command.agent
              ? command.agent
              : task?.workflow === 'agent'
                ? task.agent
                : undefined;
          if (!name) return undefined;
          const limit = (await this.agents.get({ id: name }).catch(() => undefined))?.concurrency ?? 1;
          return { name, limit };
        },
        work: (release) => this.executor.run(command, record, dir, release),
        cancelled: () => this.closeUnstarted(record, dir),
        settle: async () => {
          await unlock();
          // After the lock is free: a review fix that was pushed starts the next review round.
          void this.reviewLoop
            .runSettled(command.project, command.id)
            .catch((error: unknown) => process.stderr.write(`review loop: ${String(error)}\n`));
        },
      },
      reservation,
    );
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
  /** Spans of one task, trace or feature, as trees with rolled-up cost. */
  trace(raw: unknown) {
    return this.taskTraces.query(raw);
  }
  /** Counts across runs for one project, or every project, over `[from, to)` (default: 7 days). */
  metrics(raw: unknown) {
    return this.taskTraces.metrics(raw);
  }
  /** The newest spans of one type, e.g. every tool call or model call, for the Functions pages. */
  spans(raw: unknown) {
    return this.taskTraces.spans(raw);
  }
  /** Saved review findings of one project, or of every project. */
  async findings(raw: unknown) {
    const { project } = z.object({ project: z.union([ProjectName, z.literal('')]).optional() }).parse(raw);
    const projects = project ? [project] : (await this.projects.list()).map((p) => p.name);
    const rows = (await Promise.all(projects.map((p) => this.reviews.findings({ project: p })))).flat();
    return rows.sort((a, b) => b.at.localeCompare(a.at) || a.index - b.index);
  }
  /** MCP servers, tools and skills the factory gives its agents; `project` scopes calls and repo skills. */
  catalog(project?: string) {
    return systemCatalog({ projects: this.projects, traces: this.traces }, project);
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
    const running = this.dispatcher.active(record.id);
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
      ...(running && this.executor.activity(record.id)
        ? { activity: this.executor.activity(record.id)! }
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
    if (!latest || !this.dispatcher.active(latest.record.id))
      throw new Conflict('No run is active for this task.');
    // A run that has not started leaves the queue now; a working one reads the stop for its outcome.
    this.dispatcher.stop(latest.record.id);
    return this.executor.abort(latest.record.id) ? 'Stopping the run.' : 'Stopping the run before it starts.';
  }
  /**
   * Cancels a turn that is queued and has not started, and waits until it left the queue and freed
   * the task lock. The turn never runs and the task keeps its stage. Does nothing otherwise.
   */
  async cancelQueued(project: string, id: string): Promise<void> {
    if (!this.isWaiting(project, id)) return;
    const latest = await this.latest({ project, id });
    const completion = latest && this.dispatcher.completion(latest.record.id);
    if (!latest || !completion || this.executor.started(latest.record.id)) return;
    this.dispatcher.stop(latest.record.id);
    await completion;
  }
  /** Records a queued run a person stopped before it started. */
  private async closeUnstarted(record: RunRecord, dir: string): Promise<void> {
    record.state = 'failed';
    record.outcome = failureOutcome(undefined, true);
    record.error = 'Stopped by you before the run started.';
    record.finished_at = new Date().toISOString();
    record.cleanup = { status: 'clean' };
    await this.storage.writeDocument(join(dir, 'run.json'), record);
  }
  /**
   * Records that a person checked an uncertain cleanup: nothing from the last run still runs.
   * New runs on the task may start again. The reasons stay on the record.
   */
  async confirmCleanup(target: Target): Promise<string> {
    const { project, id } = this.target(target);
    // An active run holds the task lock for its whole life: refuse before waiting on the lock.
    const current = await this.latest(target);
    if (current && this.dispatcher.active(current.record.id))
      throw new Conflict('A run still owns this task.');
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
  async drain(graceMs = DRAIN_GRACE_MS): Promise<void> {
    // Waiting runs see the shutdown now and stay queued for the next start.
    this.dispatcher.close();
    clearTimeout(this.recoveryRetry);
    this.pickup.stop();
    this.profileChecks.stopAll();
    const deadline = setTimeout(() => {
      this.executor.abortAll();
    }, graceMs);
    try {
      // Acceptance already in flight may be reserving a lock or writing its durable record.
      await Promise.all([this.dispatcher.drained(), this.executions.drain(graceMs)]);
    } finally {
      clearTimeout(deadline);
    }
  }

  /** What startup recovery could not settle; `pending` until the first recovery ends. */
  private recovery: RecoveryReport = { state: 'pending', problems: [] };
  private recoveryRetry?: NodeJS.Timeout;
  recoveryReport(): RecoveryReport {
    return this.recovery;
  }

  /**
   * After a restart: a run that was running is marked interrupted and its task made resumable; a
   * run that never started is queued again. Call once, while this service owns the data root. A
   * project or task it cannot read goes into the recovery report, and it is retried until it
   * succeeds.
   */
  async recover(): Promise<{ requeued: number; interrupted: number; problems: number }> {
    const counts = { requeued: 0, interrupted: 0, problems: 0 };
    const problems: RecoveryProblem[] = [];
    const failed = (project: string, error: unknown, task_id?: string) =>
      problems.push({
        project,
        ...(task_id ? { task_id } : {}),
        error: error instanceof Error ? error.message : String(error),
        since: this.problemSince(project, task_id),
      });
    let projects: { name: string }[] = [];
    try {
      projects = await this.projects.list();
    } catch (error) {
      failed('*', error);
    }
    for (const project of projects) {
      let tasks: TaskRecord[];
      try {
        tasks = await this.tasks.list(project.name);
      } catch (error) {
        failed(project.name, error);
        continue;
      }
      for (const task of tasks) {
        try {
          const result = await this.reconcileTask(project.name, task.id);
          if (result) counts[result]++;
        } catch (error) {
          failed(project.name, error, task.id);
        }
      }
    }
    counts.problems = problems.length;
    this.finishRecovery(problems);
    return counts;
  }

  /** Reconciles only what the last recovery could not read. Safe to call again at any time. */
  async reconcile(): Promise<RecoveryReport> {
    if (this.recovery.state !== 'degraded') return this.recovery;
    const problems: RecoveryProblem[] = [];
    for (const problem of this.recovery.problems) {
      try {
        if (problem.project === '*') {
          await this.recover();
          return this.recovery;
        }
        const ids = problem.task_id
          ? [problem.task_id]
          : (await this.tasks.list(problem.project)).map((t) => t.id);
        for (const id of ids) {
          try {
            await this.reconcileTask(problem.project, id);
          } catch (error) {
            problems.push({
              ...problem,
              task_id: id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        problems.push({ ...problem, error: error instanceof Error ? error.message : String(error) });
      }
    }
    this.finishRecovery(problems);
    return this.recovery;
  }

  private problemSince(project: string, task_id?: string): string {
    return (
      this.recovery.problems.find((p) => p.project === project && p.task_id === task_id)?.since ??
      new Date().toISOString()
    );
  }

  private finishRecovery(problems: RecoveryProblem[]): void {
    this.recovery = {
      state: problems.length ? 'degraded' : 'ok',
      checked_at: new Date().toISOString(),
      problems,
    };
    clearTimeout(this.recoveryRetry);
    this.recoveryRetry = undefined;
    if (problems.length && this.dispatcher.accepting) {
      this.recoveryRetry = setTimeout(() => void this.reconcile().catch(() => undefined), RECOVERY_RETRY_MS);
      this.recoveryRetry.unref();
    }
  }

  /**
   * Settles one task's latest run if no live owner holds it: queued again, or interrupted. Throws
   * when the run cannot be read, so the caller reports it. A missing run is not an error.
   */
  private async reconcileTask(project: string, id: string): Promise<'requeued' | 'interrupted' | undefined> {
    const target = { project, id };
    const latest = await this.latest(target);
    if (!latest || this.dispatcher.active(latest.record.id)) return undefined;
    const { record, dir } = latest;
    if (record.state !== 'queued' && record.state !== 'running') return undefined;
    await this.tasks.clearDeadLock(project, id);
    if (record.state === 'queued') {
      const queued = await this.requeue(record, dir);
      if (queued === 'scheduled') return 'requeued';
      if (queued === 'settled') return undefined;
    }
    await this.storage.writeDocument(join(dir, 'run.json'), {
      ...record,
      state: 'interrupted',
      outcome: 'interrupted',
      // Processes of a run that was running at a crash are not known to be gone.
      ...(record.state === 'running'
        ? { cleanup: { status: 'uncertain', reasons: ['the backend stopped while the run was running'] } }
        : {}),
      error: record.state === 'queued' ? 'The run could not be queued again after a restart.' : INTERRUPTED,
      finished_at: new Date().toISOString(),
    });
    const current = await this.tasks.read(project, id);
    if (runWorking(current.stage))
      await this.tasks.write(withStage(current, new Date().toISOString(), 'failed', INTERRUPTED));
    return 'interrupted';
  }

  /**
   * Queues a recovered run again. `settled`: under the task lock the run turned out to be owned or
   * no longer queued, so nothing is done. `refused`: it cannot run again.
   */
  private async requeue(record: RunRecord, dir: string): Promise<'scheduled' | 'settled' | 'refused'> {
    const reservation = this.dispatcher.reserve();
    if (!reservation) return 'refused';
    let release: (() => Promise<void>) | undefined;
    try {
      release = await this.tasks.acquireLock(record.project, record.task_id);
      // Read again under the lock: a start in this process may have written and scheduled it.
      const fresh = await this.latest({ project: record.project, id: record.task_id });
      if (
        !fresh ||
        fresh.record.id !== record.id ||
        fresh.record.state !== 'queued' ||
        this.dispatcher.active(record.id)
      ) {
        reservation();
        await release();
        return 'settled';
      }
      const task = await this.tasks.read(record.project, record.task_id);
      if (taskCommandBlockers(task, record.action).length) throw new Error('blocked');
      this.schedule(record.command, record, dir, release, reservation);
      return 'scheduled';
    } catch {
      reservation();
      await release?.();
      return 'refused';
    }
  }
}
