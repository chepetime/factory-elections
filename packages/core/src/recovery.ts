// What startup recovery could not settle. A missing record is not a problem: the run is absent. A
// list or read that fails, or a record that does not parse, is: the backend cannot tell who owns
// that work, so it reports it and refuses to change it until a later reconciliation succeeds.
import type { InboxItem } from './inbox.ts';

export interface RecoveryProblem {
  project: string;
  /** Absent when the whole project could not be listed. */
  task_id?: string;
  error: string;
  /** When recovery first failed on it. */
  since: string;
}

export interface RecoveryReport {
  state: 'pending' | 'ok' | 'degraded';
  checked_at?: string;
  problems: RecoveryProblem[];
}

/** Why a change to the task must wait for recovery; undefined when its ownership is known. */
export function recoveryBlocker(report: RecoveryReport, project: string, id: string): string | undefined {
  const problem = report.problems.find((p) => p.project === project && (!p.task_id || p.task_id === id));
  if (!problem) return undefined;
  const what = problem.task_id ? "this task's last run" : 'this project';
  return `Recovery could not read ${what} (${problem.error}). Fix the storage error; the backend retries on its own.`;
}

/** One inbox item per problem: recovery needs a person when storage keeps failing. */
export function recoveryInboxItems(report: RecoveryReport): InboxItem[] {
  return report.problems.map((p) => ({
    id: ['recovery', p.project, p.task_id, p.since].filter(Boolean).join(':'),
    kind: 'recovery',
    project: p.project,
    title: p.task_id ? `Recovery could not read task ${p.task_id}` : `Recovery could not list ${p.project}`,
    action: 'Fix the storage error; the backend retries on its own',
    since: p.since,
    ...(p.task_id ? { task_id: p.task_id } : {}),
    detail: p.error,
  }));
}

/**
 * A record in a state that says someone works on it, with nobody working and no write for a long
 * time. `since` is the last write the record's owner would have made.
 */
export interface StuckRecord {
  project: string;
  kind: 'run' | 'review-loop' | 'feature' | 'ticket' | 'chat';
  /** The task, feature or chat id. */
  id: string;
  /** The ticket, for kind `ticket`. */
  ticket?: string;
  /** The state or step the record is stuck in. */
  state: string;
  since: string;
  /** What recovery did or found, in a sentence. */
  detail?: string;
  /** Recovery already settled it (it stopped the record); a person decides what happens next. */
  settled?: boolean;
}

/** Whether `since` is at least `afterMs` before `now` (ms since the epoch). Unreadable dates are not stuck. */
export function unsettledFor(since: string, now: number, afterMs: number): boolean {
  const at = Date.parse(since);
  return Number.isFinite(at) && now - at >= afterMs;
}

const STUCK_LABEL: Record<StuckRecord['kind'], string> = {
  run: 'Run',
  'review-loop': 'Review loop',
  feature: 'Feature step',
  ticket: 'Feature ticket',
  chat: 'Chat reply',
};

/** One inbox item per stuck record. The id is stable while the record stays in the same state. */
export function stuckInboxItems(records: readonly StuckRecord[]): InboxItem[] {
  return records.map((r) => ({
    id: [r.settled ? 'settled' : 'stuck', r.kind, r.project, r.id, r.ticket, r.state, r.since]
      .filter(Boolean)
      .join(':'),
    kind: 'recovery',
    project: r.project,
    title: r.settled
      ? `${STUCK_LABEL[r.kind]} ${r.ticket ?? r.id} was stopped by recovery`
      : `${STUCK_LABEL[r.kind]} ${r.ticket ?? r.id} is "${r.state}" and nothing is working on it`,
    action: r.settled
      ? 'Read why, then send the follow-up again or leave the PR to people'
      : 'Open it and run it again or stop it; the backend found no owner',
    since: r.since,
    ...(r.kind === 'run' || r.kind === 'review-loop' ? { task_id: r.id } : {}),
    ...(r.kind === 'feature' || r.kind === 'ticket' ? { feature_id: r.id } : {}),
    ...(r.ticket ? { ticket: r.ticket } : {}),
    ...(r.detail ? { detail: r.detail } : {}),
  }));
}
