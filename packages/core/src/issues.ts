// Tasks on a project's board ("issues" in code, since "task" already names a factory run).
// An issue is planned work with a key like CE-12; each factory run it starts is one of its runs.
import { z } from 'zod';
import { TaskId, type Stage } from './schemas.ts';
import { commandAllowedIn } from './task-controls.ts';

export const ISSUE_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
] as const;
export const IssueStatus = z.enum(ISSUE_STATUSES);
export type IssueStatus = z.infer<typeof IssueStatus>;

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

export const IssuePriority = z.enum(['none', 'low', 'medium', 'high', 'urgent']);
export type IssuePriority = z.infer<typeof IssuePriority>;

export const IssuePrefix = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,4}$/, 'must be 2 to 5 capital letters or digits, starting with a letter');

const Iso = z.string().min(1);

export const Issue = z.object({
  number: z.number().int().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(100_000).default(''),
  status: IssueStatus,
  /** When `status` was last set, by a person or by syncing from a run. */
  status_at: Iso,
  priority: IssuePriority.default('none'),
  /** Factory runs this issue started or wraps, oldest first. */
  runs: z.array(TaskId).default([]),
  jira_key: z.string().trim().min(1).max(100).optional(),
  /** The agent that works this task; moving it to In progress starts that agent's session. */
  assignee: z.string().min(1).optional(),
  comments: z
    .array(
      z.object({
        id: z.string().min(1),
        at: Iso,
        body: z.string().trim().min(1).max(20_000),
        /** The thread's first comment; replies are one level deep. */
        parent: z.string().min(1).optional(),
        /** `you`, or the id of the agent that wrote it. */
        author: z.string().min(1).default('you'),
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        at: Iso,
        kind: z.string().min(1),
        message: z.string(),
        /** Set on status changes, so the feed can show the new status icon. */
        from: IssueStatus.optional(),
        to: IssueStatus.optional(),
      }),
    )
    .default([]),
  /** Archived tasks leave the board and the sidebar; they come back with Restore. */
  archived_at: Iso.optional(),
  created_at: Iso,
  updated_at: Iso,
});
export type Issue = z.infer<typeof Issue>;

export const IssueBoard = z.object({
  next: z.number().int().min(1),
  items: z.array(Issue),
  /** Runs of deleted tasks. Sync never wraps them again, even if removing their records failed. */
  deleted_runs: z.array(TaskId).default([]),
});
export type IssueBoard = z.infer<typeof IssueBoard>;

export function issueKey(prefix: string, number: number): string {
  return `${prefix}-${number}`;
}

/** The number in a key such as `CE-12`. The prefix is not checked: it can change in settings. */
export function issueNumber(key: string): number | undefined {
  const match = /^[A-Za-z][A-Za-z0-9]{0,9}-(\d{1,9})$/.exec(key.trim());
  return match ? Number(match[1]) : undefined;
}

/** Initials of the project name's parts (`change-elections` → `CE`), or its first three letters. */
export function defaultPrefix(project: string): string {
  const parts = project.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const raw = parts.length > 1 ? parts.map((p) => p[0]).join('') : (parts[0] ?? '').slice(0, 3);
  let prefix = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
  if (!/^[A-Z]/.test(prefix)) prefix = `P${prefix}`.slice(0, 5);
  return prefix.length >= 2 ? prefix : `${prefix}X`;
}

const STAGE_STATUS: Record<Stage, IssueStatus> = {
  queued: 'todo',
  classified: 'todo',
  coding: 'in_progress',
  reviewing: 'in_review',
  'awaiting-approval': 'in_review',
  approved: 'done',
  'pr-opened': 'done',
  blocked: 'blocked',
  failed: 'blocked',
  'verification-failed': 'blocked',
  rejected: 'cancelled',
};

export function statusFromStage(stage: Stage): IssueStatus {
  return STAGE_STATUS[stage];
}

/** A run the factory is working on right now; it cannot be archived or deleted. */
export function runWorking(stage: Stage): boolean {
  return stage === 'coding' || stage === 'reviewing';
}

/** A run that has ended: nothing more happens to it unless a person revises it. */
export function runFinished(stage: Stage): boolean {
  return stage === 'rejected' || stage === 'pr-opened';
}

export type RunSummary = { stage: Stage; updated_at?: string };

/** The status to show: the latest run's, if it changed after the issue's status was last set. */
export function syncedStatus(issue: Pick<Issue, 'status' | 'status_at'>, run?: RunSummary): IssueStatus {
  if (!run) return issue.status;
  if (run.updated_at && Date.parse(run.updated_at) <= Date.parse(issue.status_at)) return issue.status;
  return statusFromStage(run.stage);
}

export type DropAction =
  | { kind: 'none' }
  | { kind: 'set-status'; status: IssueStatus }
  | { kind: 'start-run' }
  | { kind: 'run' }
  | { kind: 'reject' }
  /** Close a run that waits for a person, then put the task back in Backlog or Todo. */
  | { kind: 'requeue'; status: 'backlog' | 'todo' }
  | { kind: 'refused'; reason: string };

/**
 * What dropping an issue on a board column does. `from` is the column it shows in; `run` is its
 * latest run. Only In progress starts work, only Cancelled stops it, and the factory alone moves
 * work into In review and Blocked, so a drop can never skip the approval gate.
 */
/** Run stages that wait for a person, so moving the task back to the queue may close the run. */
const WAITING_STAGES: readonly Stage[] = ['blocked', 'failed', 'verification-failed', 'awaiting-approval'];

export function dropAction(from: IssueStatus, to: IssueStatus, run?: RunSummary): DropAction {
  if (from === to) return { kind: 'none' };
  const active = run && !runFinished(run.stage);
  if (to === 'in_review' || to === 'blocked')
    return { kind: 'refused', reason: 'The factory moves tasks into this column.' };
  if (to === 'in_progress') {
    if (!run || runFinished(run.stage)) return { kind: 'start-run' };
    if (commandAllowedIn('run', run.stage)) return { kind: 'run' };
    return { kind: 'refused', reason: 'Approve, revise or reject it from the task page.' };
  }
  if (to === 'cancelled') return active ? { kind: 'reject' } : { kind: 'set-status', status: 'cancelled' };
  // A run that waits for you (stuck, failed, or ready for review) can be closed by sending the task
  // back to the queue; a run that is working cannot.
  if (active && (to === 'backlog' || to === 'todo') && WAITING_STAGES.includes(run.stage))
    return { kind: 'requeue', status: to };
  if (active)
    return {
      kind: 'refused',
      reason: 'A run is still open. Finish it from the task page, or move the task to Cancelled.',
    };
  return { kind: 'set-status', status: to };
}
