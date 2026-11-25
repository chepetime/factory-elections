// Board tasks ("issues"), one document per project at <root>/<project>/issues.json. Every read wraps
// runs that no issue links to, which backfills old runs and catches runs started off the board.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Cause, Effect, Exit } from 'effect';
import { z } from 'zod';
import {
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
  runWorking,
  statusFromStage,
  syncedStatus,
  TaskId,
  type DropAction,
  type ProjectSettings,
  type Stage,
  type TaskRecord,
} from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';
import { Conflict } from './conflict.ts';

export type IssueRun = { id: string; stage: Stage; updated_at?: string };
export type IssueView = Omit<Issue, 'status'> & {
  key: string;
  /** The column it shows in: the latest run's status unless a person set one since. */
  status: IssueStatus;
  /** The status stored on the issue, before syncing from the run. */
  stored_status: IssueStatus;
  run?: IssueRun;
};
export type IssueList = { prefix: string; items: IssueView[] };

export type IssueDeps = {
  root: string;
  storage: DataStorage;
  tasks: { list(project: string): Promise<TaskRecord[]> };
  settings: (project: string) => Promise<ProjectSettings>;
  /** Creates a factory run and returns its id; it does not start it. */
  submit: (input: { project: string; prompt: string; jiraKey?: string }) => Promise<string>;
  run: (project: string, id: string) => Promise<unknown>;
  reject: (project: string, id: string, note: string) => Promise<unknown>;
  /** Removes a run's worktree, branch and records. Fails while the run holds its lock. */
  deleteRun: (project: string, id: string) => Promise<void>;
  /** The name of an agent that may take work; it throws for a missing or archived agent. */
  agentName?: (id: string) => Promise<string>;
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
});
const UpdateInput = z.object({
  project: ProjectName,
  key: Key,
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(100_000).optional(),
  priority: IssuePriority.optional(),
  /** An agent id, or null to unassign. */
  assignee: z.string().min(1).nullable().optional(),
});
const MoveInput = z.object({ project: ProjectName, key: Key, to: IssueStatus });
const CommentInput = z.object({
  project: ProjectName,
  key: Key,
  body: z.string().trim().min(1).max(20_000),
  parent: z.string().min(1).optional(),
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
  private readonly lock = Effect.runSync(Effect.makeSemaphore(1));
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
        events: [{ at, kind: 'created', message: 'Created from a factory run' }],
        created_at: at,
        updated_at: task.updated_at ?? at,
      });
    });
    const synced = { ...board, next, items: [...board.items, ...wrapped] };
    await this.write(project, synced);
    return { board: synced, runs };
  }

  private view(prefix: string, issue: Issue, runs: Map<string, TaskRecord>): IssueView {
    const latest = issue.runs.at(-1);
    const task = latest ? runs.get(latest) : undefined;
    const run = task ? { id: task.id, stage: task.stage, updated_at: task.updated_at } : undefined;
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

  async create(raw: unknown): Promise<IssueView> {
    const input = CreateInput.parse(raw);
    return this.serial(async () => {
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
        events: [{ at, kind: 'created', message: 'Created' }],
        created_at: at,
        updated_at: at,
      });
      await this.write(input.project, { ...board, next: board.next + 1, items: [...board.items, issue] });
      return this.view(await this.prefix(input.project), issue, runs);
    });
  }

  async update(raw: unknown): Promise<IssueView> {
    const { project, key, assignee, ...patch } = UpdateInput.parse(raw);
    if (assignee && !this.deps.agentName) throw new Conflict('Agents are not available.');
    const agentName = assignee ? await this.deps.agentName!(assignee) : undefined;
    return this.change(project, key, (issue, at) => {
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
      if (!events.length) return issue;
      return { ...next, events: [...issue.events, ...events] };
    });
  }

  async comment(raw: unknown): Promise<IssueView> {
    const { project, key, body, parent } = CommentInput.parse(raw);
    return this.change(project, key, (issue, at) => {
      const target = parent ? issue.comments.find((c) => c.id === parent) : undefined;
      if (parent && !target) throw new Conflict('The comment you replied to is gone.');
      // A reply to a reply joins the same thread.
      const root = target?.parent ?? target?.id;
      return {
        ...issue,
        comments: [
          ...issue.comments,
          { id: randomUUID(), at, body, author: 'you', ...(root ? { parent: root } : {}) },
        ],
      };
    });
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
      if (action.kind === 'start-run') {
        runId = await this.deps.submit({ project, prompt: issuePrompt(issue), jiraKey: issue.jira_key });
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

    if ((plan.action.kind === 'start-run' || plan.action.kind === 'run') && plan.runId)
      await this.deps.run(project, plan.runId);
    if (plan.action.kind === 'reject' && plan.runId) {
      await this.deps.reject(project, plan.runId, 'Cancelled from the task board.');
      await this.change(project, `N-${plan.number}`, (issue, at) => ({
        ...issue,
        status: 'cancelled',
        status_at: at,
      }));
    }
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
      if (archived && stage && runWorking(stage))
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
        return stage && runWorking(stage);
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
