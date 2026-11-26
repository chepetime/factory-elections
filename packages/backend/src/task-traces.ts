// The span ledger entries of task work: a run's root span, the PR opening, the approval gate, and
// the trace and metrics queries over them. Runs and commands call it; it never decides an outcome.
import { z } from 'zod';
import {
  metricsSummary,
  newSpanId,
  newTraceId,
  ProjectName,
  taskClass,
  traceTree,
  UNUSUAL_LOOKBACK_MS,
  type RepoProfile,
  type TaskRecord,
  type TraceScope,
} from '@factory/core';
import { readProfile } from '@factory/adapters-fs';
import { commitOf } from '@factory/adapters-git';
import type { TraceLog } from '@factory/evidence';

/** What a run's root span reads from its run record. */
export interface TracedRun {
  id: string;
  state: string;
  error?: string;
}

export interface TaskTracesDeps {
  root: string;
  tasks: { read(project: string, id: string): Promise<TaskRecord> };
  traces: TraceLog;
  /** The feature a ticket task belongs to, for its links. */
  features: {
    read(project: string, id: string): Promise<{ tickets: { id: string; external?: { key?: string } }[] }>;
  };
  projects: { list(): Promise<{ name: string }[]> };
}

/** When a task at the approval gate reached it: its latest gate input. */
const gateOpenedAt = (task: TaskRecord): string | undefined =>
  [task.pr_draft?.at, task.review?.at, task.verification?.at, task.updated_at]
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);

export class TaskTraces {
  private readonly deps: TaskTracesDeps;
  constructor(deps: TaskTracesDeps) {
    this.deps = deps;
  }

  /** The trace of one task run: its root span id and the fields its spans share. */
  async start(project: string, id: string) {
    const task = await this.deps.tasks.read(project, id);
    const profile = await readProfile(this.deps.root, project).catch(() => undefined);
    const base_branch = task.worktree?.base_branch ?? task.stack_on ?? profile?.repo.base_branch.value;
    const runSpan = newSpanId();
    const scope: TraceScope = {
      trace_id: newTraceId(),
      project,
      task_id: id,
      parent_span_id: runSpan,
      ...(await this.links(task)),
    };
    return {
      scope,
      runSpan,
      started: Date.now(),
      task,
      profile,
      base_branch,
      base_sha: await commitOf(task.worktree?.path ?? task.repo, base_branch),
    };
  }
  /** The ticket, feature, PR and class a task's spans carry. */
  async links(task: TaskRecord): Promise<Partial<TraceScope>> {
    const feature = task.ticket
      ? await this.deps.features.read(task.project, task.ticket.feature).catch(() => undefined)
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
  async end(
    trace: NonNullable<Awaited<ReturnType<TaskTraces['start']>>>,
    action: string,
    record: TracedRun,
  ): Promise<void> {
    const task = await this.deps.tasks
      .read(trace.scope.project, trace.scope.task_id!)
      .catch(() => trace.task);
    const commands: RepoProfile['commands'] | undefined = trace.profile?.commands;
    const { parent_span_id: _, ...shared } = trace.scope;
    this.deps.traces.append(
      {
        ...shared,
        ...(await this.links(task)),
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
    await this.deps.traces.flush();
  }
  /** Marks the moment a task's PR opened, so the task's traces join to the PR. */
  async pr(project: string, id: string): Promise<void> {
    const task = await this.deps.tasks.read(project, id);
    if (!task.pr) return;
    const at = new Date().toISOString();
    this.deps.traces.append(
      { trace_id: newTraceId(), project, task_id: id, ...(await this.links(task)) },
      { type: 'pr', name: 'PR opened', started_at: at, ended_at: at, duration_ms: 0, outcome: 'completed' },
    );
    await this.deps.traces.flush();
  }
  /** The time a task waited at the approval gate, as a span, when the human acts on it. */
  async gate(task: TaskRecord, decision: string): Promise<void> {
    if (task.stage !== 'awaiting-approval') return;
    const opened = gateOpenedAt(task);
    const ended = new Date().toISOString();
    this.deps.traces.append(
      { trace_id: newTraceId(), project: task.project, task_id: task.id, ...(await this.links(task)) },
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
    await this.deps.traces.flush();
  }
  /** Spans of one task, trace or feature, as trees with rolled-up cost. */
  async query(raw: unknown) {
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
    const spans = await this.deps.traces.read(project, filter);
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
    const projects = q.project ? [q.project] : (await this.deps.projects.list()).map((p) => p.name);
    const historyStart = new Date(Date.parse(from) - UNUSUAL_LOOKBACK_MS).toISOString();
    const spans = (
      await Promise.all(projects.map((p) => this.deps.traces.read(p, { since: historyStart })))
    ).flat();
    return metricsSummary(spans, from, to);
  }
}
