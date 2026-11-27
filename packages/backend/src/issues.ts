// Board tasks ("issues"), one document per project at <root>/<project>/issues.json. Every read wraps
// runs that no issue links to, which backfills old runs and catches runs started off the board.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Cause, Effect, Exit, Semaphore } from 'effect';
import { z } from 'zod';
import {
  ReviewOutcome,
  asksForBaseMerge,
  parseMentions,
  defaultPrefix,
  dropAction,
  Issue,
  IssueBoard,
  ISSUE_STATUS_LABELS,
  IssuePriority,
  IssueStatus,
  issueKey,
  issueNumber,
  ProjectName,
  runHeld,
  statusFromStage,
  syncedStatus,
  TaskId,
  type DropAction,
  type FollowUpKind,
  PlanDate,
  followUpAgent,
  type ProjectSettings,
  type Stage,
  type TaskRecord,
  type QueueWait,
  type IssueList,
  type IssueRun,
  type IssueView,
} from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';
import { Conflict } from '@factory/core';

export type IssueDeps = {
  root: string;
  storage: DataStorage;
  tasks: { list(project: string): Promise<TaskRecord[]> };
  /** Whether a run of this task is accepted, running or finalizing in this backend. */
  owned?: (project: string, id: string) => boolean;
  settings: (project: string) => Promise<ProjectSettings>;
  /** Creates a factory run and returns its id; it does not start it. */
  submit: (input: { project: string; prompt: string; jiraKey?: string; agent?: string }) => Promise<string>;
  /** Sends a person's note to a waiting run; agent runs resume their session with it. */
  revise?: (project: string, id: string, note: string) => Promise<unknown>;
  /** Starts the task's run; `reply` is a person's comment the agent reads (blocked agent tasks). */
  run: (project: string, id: string, reply?: string) => Promise<unknown>;
  reject: (project: string, id: string, note: string) => Promise<unknown>;
  /** Queues a follow-up on a run whose PR is open (core follow-ups.ts). */
  followUp?: (
    project: string,
    id: string,
    input: { note: string; kind: FollowUpKind; agent: string; by?: string; prHead?: string },
  ) => Promise<unknown>;
  /** Takes a queued turn out of the queue before a reject: the queued turn holds the run's lock. */
  cancelQueued?: (project: string, id: string) => Promise<unknown>;
  /** Removes a run's worktree, branch and records. Fails while the run holds its lock. */
  deleteRun: (project: string, id: string) => Promise<void>;
  /** The name of an agent that may take work; it throws for a missing or archived agent. */
  agentName?: (id: string) => Promise<string>;
  /** The ids of the agents a comment can @mention (not archived). */
  agentIds?: () => Promise<string[]>;
  /** Why the run's queued turn has not started yet; undefined when no turn waits. */
  waiting?: (project: string, runId: string) => QueueWait | undefined;
  /** Starts the next review round of a review ticket (moving it to In progress does this). */
  startReview?: (project: string, key: string) => Promise<unknown>;
  /** Called after a person edits, moves or creates a task, e.g. to let agents pick up work. */
  changed?: () => void;
  now?: () => Date;
};

const Key = z.string().trim().min(1).max(64);
const CreateInput = z.object({
  project: ProjectName,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(100_000).default(''),
  status: z.enum(['backlog', 'todo']).default('backlog'),
  priority: IssuePriority.default('none'),
  jira_key: z.string().trim().max(100).optional(),
  /** `you` from the board; an agent's id when its tool creates the task. */
  created_by: z.string().min(1).max(100).default('you'),
});
const UpdateInput = z.object({
  project: ProjectName,
  key: Key,
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(100_000).optional(),
  priority: IssuePriority.optional(),
  /** An agent id, or null to unassign. */
  assignee: z.string().min(1).nullable().optional(),
  /** A `YYYY-MM-DD` day, or null to clear it. */
  start_date: PlanDate.nullable().optional(),
  due_date: PlanDate.nullable().optional(),
});
const MoveInput = z.object({ project: ProjectName, key: Key, to: IssueStatus });
const FollowUpInput = z.object({
  project: ProjectName,
  key: Key,
  note: z.string().trim().min(1).max(20_000),
  kind: z.enum(['custom', 'conflicts', 'review']).default('custom'),
  /** The workspace agent; absent uses the run's agent, then the task's assignee. */
  agent: z.string().min(1).optional(),
  /** `factory` when the conflict watcher adds it. */
  by: z.enum(['you', 'factory']).default('you'),
  /** The PR head the watcher saw, so it adds one follow-up per head. */
  pr_head: z.string().min(1).max(64).optional(),
});
const CommentInput = z.object({
  project: ProjectName,
  key: Key,
  body: z.string().trim().min(1).max(20_000),
  parent: z.string().min(1).optional(),
  /** Set by the factory for an agent's comment; people always comment as `you`. */
  author: z.string().min(1).optional(),
});
const StatusInput = z.object({
  project: ProjectName,
  key: Key,
  status: IssueStatus,
  /** Who set it, for the activity feed, e.g. the agent's name. */
  by: z.string().min(1),
});

function firstLine(text: string): string {
  const line =
    text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? text.trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/** The prompt a run started from the board gets: the title, then the description. */
export function issuePrompt(issue: Pick<Issue, 'title' | 'description'>): string {
  return issue.description.trim() ? `${issue.title}\n\n${issue.description.trim()}` : issue.title;
}

export class IssueService {
  private readonly lock = Effect.runSync(Semaphore.make(1));
  private readonly deps: IssueDeps;
  constructor(deps: IssueDeps) {
    this.deps = deps;
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }
  private path(project: string): string {
    return join(this.deps.root, ProjectName.parse(project), 'issues.json');
  }
  /** Runs `work` alone, and rethrows its own error (a Conflict stays a Conflict for the RPC layer). */
  private async serial<T>(work: () => Promise<T>): Promise<T> {
    const exit = await Effect.runPromiseExit(
      this.lock.withPermits(1)(Effect.tryPromise({ try: work, catch: (error) => error })),
    );
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  }
  private async read(project: string): Promise<IssueBoard> {
    try {
      return IssueBoard.parse(await this.deps.storage.readDocument(this.path(project)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { next: 1, items: [], deleted_runs: [] };
      throw error;
    }
  }
  private write(project: string, board: IssueBoard): Promise<void> {
    return this.deps.storage.writeDocument(this.path(project), board);
  }
  private async prefix(project: string): Promise<string> {
    return (await this.deps.settings(project)).prefix || defaultPrefix(project);
  }

  /** Wraps every unlinked run in a new issue, oldest first. Call under the lock. */
  private async sync(project: string): Promise<{ board: IssueBoard; runs: Map<string, TaskRecord> }> {
    const [board, tasks] = await Promise.all([this.read(project), this.deps.tasks.list(project)]);
    const runs = new Map(tasks.map((t) => [t.id, t]));
    const linked = new Set([...board.items.flatMap((i) => i.runs), ...board.deleted_runs]);
    const unlinked = tasks
      .filter((t) => !linked.has(t.id))
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id));
    if (!unlinked.length) return { board, runs };
    let next = board.next;
    const now = this.now();
    const wrapped = unlinked.map((task) => {
      const at = task.created_at ?? now;
      return Issue.parse({
        number: next++,
        title: task.name ?? firstLine(task.prompt),
        description: task.prompt,
        status: statusFromStage(task.stage),
        status_at: at,
        runs: [task.id],
        jira_key: task.jira_key,
        created_by: 'factory',
        events: [{ at, kind: 'created', message: 'Created from a factory run' }],
        created_at: at,
        updated_at: task.updated_at ?? at,
      });
    });
    const synced = { ...board, next, items: [...board.items, ...wrapped] };
    await this.write(project, synced);
    return { board: synced, runs };
  }

  /** A turn is queued for the run: it will use the run's worktree once its agent is free. */
  private queued(project: string, runId: string): QueueWait | undefined {
    return this.deps.waiting?.(project, runId);
  }

  /** The factory holds the run now: a live run, or a working stage when live runs are not known. */
  private held(project: string, runId: string, stage: Stage | undefined): boolean {
    return !!stage && runHeld(stage, this.deps.owned?.(project, runId));
  }

  private view(prefix: string, issue: Issue, runs: Map<string, TaskRecord>): IssueView {
    const latest = issue.runs.at(-1);
    const task = latest ? runs.get(latest) : undefined;
    const waiting = task ? this.queued(task.project, task.id) : undefined;
    const run = task
      ? {
          id: task.id,
          stage: task.stage,
          updated_at: task.updated_at,
          ...(waiting ? { waiting: true, waiting_for: waiting } : {}),
          owned: this.deps.owned?.(task.project, task.id) ?? false,
        }
      : undefined;
    return {
      ...issue,
      key: issueKey(prefix, issue.number),
      stored_status: issue.status,
      status: syncedStatus(issue, run),
      run,
    };
  }

  /** Finds an issue by key (any prefix) or by the id of one of its runs. */
  private find(board: IssueBoard, key: string): Issue {
    const number = issueNumber(key);
    const issue = TaskId.safeParse(key).success
      ? board.items.find((i) => i.runs.includes(key))
      : board.items.find((i) => i.number === number);
    if (!issue) throw Object.assign(new Error(`Task not found: ${key}`), { code: 'ENOENT' });
    return issue;
  }

  /** One read-change-write of a ticket, for services that own a ticket field (review tickets). */
  edit(project: string, key: string, change: (issue: Issue, at: string) => Issue): Promise<IssueView> {
    return this.change(project, key, change);
  }

  private async change(
    project: string,
    key: string,
    edit: (issue: Issue, at: string) => Issue,
  ): Promise<IssueView> {
    return this.serial(async () => {
      const { board, runs } = await this.sync(project);
      const current = this.find(board, key);
      const at = this.now();
      const updated = Issue.parse({ ...edit(current, at), updated_at: at });
      await this.write(project, {
        ...board,
        items: board.items.map((i) => (i.number === current.number ? updated : i)),
      });
      return this.view(await this.prefix(project), updated, runs);
    });
  }

  async list(rawProject: unknown): Promise<IssueList> {
    const project = ProjectName.parse(rawProject);
    return this.serial(async () => {
      const { board, runs } = await this.sync(project);
      const prefix = await this.prefix(project);
      return { prefix, items: board.items.map((i) => this.view(prefix, i, runs)) };
    });
  }

  async get(raw: unknown): Promise<IssueView> {
    const { project, key } = z.object({ project: ProjectName, key: Key }).parse(raw);
    return this.serial(async () => {
      const { board, runs } = await this.sync(project);
      return this.view(await this.prefix(project), this.find(board, key), runs);
    });
  }

  async create(raw: unknown, extra: { review?: Issue['review'] } = {}): Promise<IssueView> {
    const input = CreateInput.parse(raw);
    const created = await this.serial(async () => {
      const { board, runs } = await this.sync(input.project);
      const at = this.now();
      const issue = Issue.parse({
        number: board.next,
        title: input.title,
        description: input.description,
        status: input.status,
        status_at: at,
        priority: input.priority,
        jira_key: input.jira_key || undefined,
        created_by: input.created_by,
        ...(extra.review ? { review: extra.review } : {}),
        events: [{ at, kind: 'created', message: 'Created' }],
        created_at: at,
        updated_at: at,
      });
      await this.write(input.project, { ...board, next: board.next + 1, items: [...board.items, issue] });
      return this.view(await this.prefix(input.project), issue, runs);
    });
    this.deps.changed?.();
    return created;
  }

  async update(raw: unknown): Promise<IssueView> {
    const { project, key, assignee, start_date, due_date, ...patch } = UpdateInput.parse(raw);
    if (assignee && !this.deps.agentName) throw new Conflict('Agents are not available.');
    const agentName = assignee ? await this.deps.agentName!(assignee) : undefined;
    const updated = await this.change(project, key, (issue, at) => {
      const changed = Object.entries(patch).filter(
        ([field, value]) => value !== undefined && value !== issue[field as keyof Issue],
      );
      const events = changed.map(([field]) => ({
        at,
        kind: `edit:${field}`,
        message: `Changed the ${field}`,
      }));
      let next: Issue = { ...issue, ...Object.fromEntries(changed) };
      if (assignee !== undefined && (assignee ?? undefined) !== issue.assignee) {
        const { assignee: _old, ...rest } = next;
        next = assignee ? { ...rest, assignee } : rest;
        events.push({
          at,
          kind: 'edit:assignee',
          message: assignee ? `Assigned to ${agentName}` : 'Removed the agent',
        });
      }
      const start = start_date === undefined ? issue.start_date : (start_date ?? undefined);
      const due = due_date === undefined ? issue.due_date : (due_date ?? undefined);
      if (start && due && due < start) throw new Conflict('The due date is before the start date.');
      for (const [field, value, label] of [
        ['start_date', start_date, 'start date'],
        ['due_date', due_date, 'due date'],
      ] as const) {
        if (value === undefined || (value ?? undefined) === issue[field]) continue;
        const { [field]: _old, ...rest } = next;
        next = value ? { ...rest, [field]: value } : rest;
        events.push({
          at,
          kind: `edit:${field}`,
          message: value ? `Set the ${label} to ${value}` : `Removed the ${label}`,
        });
      }
      if (!events.length) return issue;
      return { ...next, events: [...issue.events, ...events] };
    });
    this.deps.changed?.();
    return updated;
  }

  async comment(raw: unknown): Promise<IssueView> {
    const { project, key, body, parent, author = 'you' } = CommentInput.parse(raw);
    const mentions = parseMentions(body, (await this.deps.agentIds?.()) ?? []);
    const view = await this.change(project, key, (issue, at) => {
      const target = parent ? issue.comments.find((c) => c.id === parent) : undefined;
      if (parent && !target) throw new Conflict('The comment you replied to is gone.');
      // A reply to a reply joins the same thread.
      const root = target?.parent ?? target?.id;
      return {
        ...issue,
        comments: [
          ...issue.comments,
          {
            id: randomUUID(),
            at,
            body,
            author,
            ...(root ? { parent: root } : {}),
            ...(mentions.length ? { mentions } : {}),
          },
        ],
      };
    });
    // Only a person's comment starts work: an agent's mention never wakes another agent.
    if (author !== 'you') return view;
    const routed = mentions.length ? await this.routeMention(project, view, body, mentions) : undefined;
    if (routed) return routed;
    await this.wakeAgent(project, view, body);
    return view;
  }

  /**
   * A person @mentioned agents. The run's agent, if mentioned, else the first one, gets the comment:
   * - the PR is open: a follow-up for that agent (the run's own agent too), with the comment as its note;
   * - the agent of the run: its session continues, as with any comment (returns undefined);
   * - no run and no agent yet: the mentioned agent is assigned.
   * Otherwise the ticket says why the mention started nothing.
   */
  private async routeMention(
    project: string,
    view: IssueView,
    body: string,
    mentions: string[],
  ): Promise<IssueView | undefined> {
    const record = view.run && (await this.deps.tasks.list(project)).find((t) => t.id === view.run!.id);
    const runAgent = record?.workflow === 'agent' ? record.agent : undefined;
    // The run's agent first, when it is mentioned: it knows the branch.
    const agent = runAgent && mentions.includes(runAgent) ? runAgent : mentions[0]!;
    const name = this.deps.agentName ? await this.deps.agentName(agent).catch(() => agent) : agent;
    const explain = (message: string) =>
      this.change(project, view.key, (issue, at) => ({
        ...issue,
        events: [...issue.events, { at, kind: 'mention', message }],
      }));
    if (view.run?.stage === 'pr-opened') {
      if (view.run.waiting || view.run.owned)
        return explain(`${name} was mentioned, but a follow-up is already queued or working on this task.`);
      return this.followUp({ project, key: view.key, note: body, kind: 'custom', agent, by: 'you' });
    }
    // Waiting on a person, the run's agent continues its session with the comment.
    if (agent === runAgent) return undefined;
    if (!view.run && !view.assignee) return this.update({ project, key: view.key, assignee: agent });
    if (!view.run)
      return explain(`${name} was mentioned; the task is assigned to another agent, so nothing started.`);
    return explain(
      `${name} was mentioned, but ${runAgent ? 'another agent works this run' : 'the pipeline works this run'}. Mention its agent, or add a follow-up once the PR is open.`,
    );
  }

  /**
   * Adds a follow-up to a task whose PR is open: an agent continues the same branch and PR, and the
   * task moves through the board again (Todo while queued, In progress, In review or Blocked).
   */
  async followUp(raw: unknown): Promise<IssueView> {
    const parsed = FollowUpInput.parse(raw);
    const { project, key, note, agent: picked, by, pr_head } = parsed;
    // "Merge main", "resolve the conflicts": the factory merges the base itself (outside the sandbox).
    const kind = parsed.kind === 'custom' && asksForBaseMerge(note) ? 'conflicts' : parsed.kind;
    if (!this.deps.followUp) throw new Conflict('Follow-ups are not available here.');
    const view = await this.get({ project, key });
    const record = view.run && (await this.deps.tasks.list(project)).find((t) => t.id === view.run!.id);
    if (!view.run || !record || view.run.stage !== 'pr-opened')
      throw new Conflict('A follow-up continues a task whose pull request is open.');
    // One at a time: a second start would wait for the lock the queued turn holds.
    if (view.run.waiting || view.run.owned)
      throw new Conflict('A follow-up is already queued or working on this task.');
    const agent = picked ?? followUpAgent(record, view.assignee);
    if (!agent) throw new Conflict('Pick the agent that does the follow-up.');
    // Refuses a missing or archived agent before anything is queued.
    const name = this.deps.agentName ? await this.deps.agentName(agent) : agent;
    await this.deps.followUp(project, view.run.id, {
      note,
      kind,
      agent,
      by,
      ...(pr_head ? { prHead: pr_head } : {}),
    });
    return this.change(project, key, (issue, at) => ({
      ...issue,
      ...(issue.assignee ? {} : { assignee: agent }),
      events: [
        ...issue.events,
        {
          at,
          kind: 'follow-up',
          message: `${by === 'factory' ? 'The factory added a' : 'Added a'} follow-up for ${name}: ${firstLine(note)}`,
        },
      ],
    }));
  }

  /**
   * A person's comment continues the task's agent session when the agent is waiting on them:
   * its change is in review, its checks failed, it stopped, or it asked for help. An approved,
   * rejected or merged run is never restarted by a comment.
   */
  private async wakeAgent(project: string, view: IssueView, body: string): Promise<void> {
    if (!view.run) return;
    const record = (await this.deps.tasks.list(project)).find((t) => t.id === view.run!.id);
    if (record?.workflow !== 'agent') return;
    const start =
      record.stage === 'blocked'
        ? this.deps.run(project, record.id, body)
        : ['awaiting-approval', 'verification-failed', 'failed'].includes(record.stage) && this.deps.revise
          ? this.deps.revise(project, record.id, body)
          : undefined;
    await start?.catch((error: unknown) =>
      process.stderr.write(
        `comment ${view.key}: could not wake the agent: ${error instanceof Error ? error.message : error}\n`,
      ),
    );
  }

  /**
   * The task's PR changed state on GitHub (the tending pass reads it). Merged: the task is Done.
   * Closed without a merge: Cancelled. Reopened: back to In review. Only the latest run's PR moves
   * the task, and each change is recorded once.
   */
  async prOutcome(
    project: string,
    runId: string,
    pr: { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED' },
  ): Promise<IssueView | undefined> {
    const view = await this.get({ project, key: runId }).catch(() => undefined);
    if (!view || view.run?.id !== runId) return undefined;
    const known = view.pr_outcome;
    if (pr.state === 'OPEN') {
      if (!known || known.number !== pr.number) return undefined;
      return this.change(project, view.key, (issue, at) => {
        const { pr_outcome: _gone, ...rest } = issue;
        return {
          ...rest,
          status: 'in_review',
          status_at: at,
          events: [...issue.events, { at, kind: 'pr-outcome', message: `PR #${pr.number} was reopened.` }],
        };
      });
    }
    const merged = pr.state === 'MERGED';
    if (known?.state === pr.state && known.number === pr.number) {
      // Recorded already, but a later run stage (a follow-up settled after the merge) shows the
      // task in review again: set the status once more, without a second event. A status a person
      // set since is theirs.
      const status = merged ? 'done' : 'cancelled';
      if (view.status === status || view.stored_status !== status) return undefined;
      return this.change(project, view.key, (issue, at) => ({ ...issue, status, status_at: at }));
    }
    return this.change(project, view.key, (issue, at) => ({
      ...issue,
      pr_outcome: { state: pr.state as 'MERGED' | 'CLOSED', number: pr.number, at },
      status: merged ? 'done' : 'cancelled',
      status_at: at,
      events: [
        ...issue.events,
        {
          at,
          kind: 'pr-outcome',
          message: merged
            ? `PR #${pr.number} was merged. The task is done.`
            : `PR #${pr.number} was closed without a merge. The task is cancelled.`,
        },
      ],
    }));
  }

  /** Adds an event for the activity feed, unless the last event says the same. */
  async note(raw: unknown): Promise<IssueView> {
    const { project, key, kind, message, review } = z
      .object({
        project: ProjectName,
        key: Key,
        kind: z.string().min(1),
        message: z.string().min(1).max(2000),
        review: ReviewOutcome.optional(),
      })
      .parse(raw);
    return this.change(project, key, (issue, at) =>
      issue.events.at(-1)?.message === message
        ? issue
        : { ...issue, events: [...issue.events, { at, kind, message, ...(review ? { review } : {}) }] },
    );
  }

  /** Sets the stored status with no command: for an agent reporting where its work stands. */
  async setStatus(raw: unknown): Promise<IssueView> {
    const { project, key, status, by } = StatusInput.parse(raw);
    return this.change(project, key, (issue, at) =>
      issue.status === status
        ? issue
        : {
            ...issue,
            status,
            status_at: at,
            events: [
              ...issue.events,
              {
                at,
                kind: `move:${status}`,
                message: `${by} changed status from ${ISSUE_STATUS_LABELS[issue.status]} to ${ISSUE_STATUS_LABELS[status]}`,
                from: issue.status,
                to: status,
              },
            ],
          },
    );
  }

  /** Applies a board drop. Returns what it did, so the board can say so. */
  async move(raw: unknown): Promise<{ action: DropAction['kind']; issue: IssueView }> {
    const { project, key, to } = MoveInput.parse(raw);
    // Decide and link under the lock; the slow commands (a run, a reject) run outside it.
    const plan = await this.serial(async () => {
      const { board, runs } = await this.sync(project);
      const issue = this.find(board, key);
      const prefix = await this.prefix(project);
      const view = this.view(prefix, issue, runs);
      const action = dropAction(view.status, to, view.run);
      if (action.kind === 'refused') throw new Conflict(action.reason);
      if (action.kind === 'follow-up')
        throw new Conflict('The pull request is open. Add a follow-up with instructions from the task page.');
      const at = this.now();
      const event = (message: string) => ({ at, kind: `move:${to}`, message });
      let updated = issue;
      let runId = view.run?.id;
      if (action.kind === 'set-status')
        updated = {
          ...issue,
          status: action.status,
          status_at: at,
          events: [
            ...issue.events,
            {
              ...event(
                `Changed status from ${ISSUE_STATUS_LABELS[view.status]} to ${ISSUE_STATUS_LABELS[action.status]}`,
              ),
              from: view.status,
              to: action.status,
            },
          ],
        };
      if (action.kind === 'start-run' && issue.review)
        return { action: { kind: 'start-review' as const }, runId: undefined, number: issue.number };
      if (action.kind === 'start-run') {
        runId = await this.deps.submit({
          project,
          prompt: issuePrompt(issue),
          ...(issue.jira_key ? { jiraKey: issue.jira_key } : {}),
          ...(issue.assignee ? { agent: issue.assignee } : {}),
        });
        updated = {
          ...issue,
          runs: [...issue.runs, runId],
          events: [...issue.events, event('Started a run')],
        };
      }
      if (action.kind === 'run') updated = { ...issue, events: [...issue.events, event('Ran again')] };
      if (action.kind === 'reject')
        updated = { ...issue, events: [...issue.events, event('Cancelled the run')] };
      if (updated !== issue) {
        updated = Issue.parse({ ...updated, updated_at: at });
        await this.write(project, {
          ...board,
          items: board.items.map((i) => (i.number === issue.number ? updated : i)),
        });
      }
      return { action, runId, number: issue.number };
    });

    if (plan.action.kind === 'start-review') {
      if (!this.deps.startReview) throw new Conflict('PR reviews are not available here.');
      await this.deps.startReview(project, key);
      return { action: 'start-run', issue: await this.get({ project, key }) };
    }
    if ((plan.action.kind === 'start-run' || plan.action.kind === 'run') && plan.runId)
      await this.deps.run(project, plan.runId);
    if (plan.action.kind === 'requeue' && plan.runId) {
      const status = plan.action.status;
      await this.deps.reject(
        project,
        plan.runId,
        `Moved back to ${ISSUE_STATUS_LABELS[status]} from the task board.`,
      );
      // Written only once the run has closed, so a failed close leaves no false note behind.
      await this.change(project, `N-${plan.number}`, (issue, at) => ({
        ...issue,
        status,
        status_at: at,
        events: [
          ...issue.events,
          {
            at,
            kind: `move:${status}`,
            message: `Closed the open run and moved the task back to ${ISSUE_STATUS_LABELS[status]}`,
            from: issue.status,
            to: status,
          },
        ],
      }));
    }
    if (plan.action.kind === 'reject' && plan.runId) {
      // Without this, the reject waits for the lock until the queued turn got an agent and ran.
      await this.deps.cancelQueued?.(project, plan.runId);
      await this.deps.reject(project, plan.runId, 'Cancelled from the task board.');
      await this.change(project, `N-${plan.number}`, (issue, at) => ({
        ...issue,
        status: 'cancelled',
        status_at: at,
      }));
    }
    this.deps.changed?.();
    return { action: plan.action.kind, issue: await this.get({ project, key: `N-${plan.number}` }) };
  }

  /** Archives or restores a task. A run the factory is working on keeps its task on the board. */
  async archive(raw: unknown): Promise<IssueView> {
    const { project, key, archived } = z
      .object({ project: ProjectName, key: Key, archived: z.boolean() })
      .parse(raw);
    return this.serial(async () => {
      const { board, runs } = await this.sync(project);
      const issue = this.find(board, key);
      const latest = issue.runs.at(-1);
      const stage = latest ? runs.get(latest)?.stage : undefined;
      if (archived && latest && (this.held(project, latest, stage) || this.queued(project, latest)))
        throw new Conflict('The factory is working on this task. Wait for the run to stop, or cancel it.');
      const at = this.now();
      const updated = Issue.parse({
        ...issue,
        archived_at: archived ? at : undefined,
        updated_at: at,
        events: [
          ...issue.events,
          { at, kind: archived ? 'archived' : 'restored', message: archived ? 'Archived' : 'Restored' },
        ],
      });
      await this.write(project, {
        ...board,
        items: board.items.map((i) => (i.number === issue.number ? updated : i)),
      });
      return this.view(await this.prefix(project), updated, runs);
    });
  }

  /**
   * Deletes a task and its runs: worktrees, branches and records. Only archived tasks can be deleted.
   * The runs are marked deleted first, so a failed removal never brings them back as new tasks.
   */
  async delete(raw: unknown): Promise<{ key: string; failed: { run: string; error: string }[] }> {
    const { project, key } = z.object({ project: ProjectName, key: Key }).parse(raw);
    const removed = await this.serial(async () => {
      const { board, runs } = await this.sync(project);
      const issue = this.find(board, key);
      if (!issue.archived_at) throw new Conflict('Archive the task before you delete it.');
      const working = issue.runs.find((id) => {
        const stage = runs.get(id)?.stage;
        return this.held(project, id, stage) || this.queued(project, id);
      });
      if (working)
        throw new Conflict('The factory is working on this task. Wait for the run to stop, or cancel it.');
      await this.write(project, {
        ...board,
        items: board.items.filter((i) => i.number !== issue.number),
        deleted_runs: [...new Set([...board.deleted_runs, ...issue.runs])],
      });
      return { issue, prefix: await this.prefix(project) };
    });
    const failed: { run: string; error: string }[] = [];
    for (const run of removed.issue.runs)
      await this.deps.deleteRun(project, run).catch((error: unknown) => {
        failed.push({ run, error: error instanceof Error ? error.message : String(error) });
      });
    return { key: issueKey(removed.prefix, removed.issue.number), failed };
  }
}

export type { IssueList, IssueRun, IssueView };
