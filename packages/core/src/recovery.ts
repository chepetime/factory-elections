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

/** Git locks outside a task's own files, found when its run resumed. They are never removed. */
export interface ForeignLocks {
  project: string;
  task_id: string;
  paths: string[];
  since: string;
}

/** One inbox item per task that found a lock it does not own: a person checks that no git runs there. */
export function foreignLockInboxItems(found: readonly ForeignLocks[]): InboxItem[] {
  return found.map((f) => ({
    id: ['recovery', 'locks', f.project, f.task_id, f.since].join(':'),
    kind: 'recovery',
    project: f.project,
    task_id: f.task_id,
    title: `Git locks in the repository of task ${f.task_id} were left alone`,
    action: 'Check that no git command runs in the repository, then delete the lock files',
    since: f.since,
    detail: f.paths.join('\n'),
  }));
}
