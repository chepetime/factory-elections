// Numbers for one project card on the app homepage, from its runs and board tasks.
import { runAttention, type Issue, type IssueStatus, type TaskRecord } from '@factory/core';

const CLOSED: IssueStatus[] = ['done', 'cancelled'];

export interface ProjectStats {
  /** Board tasks that are not archived, done or cancelled. */
  openTasks: number;
  /** Runs the factory is working on. */
  running: number;
  /** Runs where a person has the next move: review, open the pull request, a blocker or a failure. */
  needsYou: number;
  /** Runs that opened a pull request, all time. */
  pullRequests: number;
  /** Model spend of runs that finished this calendar month. */
  spendThisMonth: number;
  /** The newest update of any run or board task. */
  lastActivity?: string;
}

type BoardTask = Pick<Issue, 'status' | 'updated_at'> & {
  archived_at?: string | undefined;
  /** The task's latest run, with live ownership when the backend reports it. */
  run?: { id: string; owned?: boolean | undefined; waiting?: boolean | undefined } | undefined;
};

export function projectStats(
  runs: readonly TaskRecord[],
  tasks: readonly BoardTask[],
  now = new Date(),
): ProjectStats {
  const sameMonth = (iso: string | undefined) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  };
  const times = [...runs.map((r) => r.updated_at ?? r.created_at), ...tasks.map((t) => t.updated_at)].filter(
    (t): t is string => Boolean(t),
  );
  const lastActivity = times.sort().at(-1);
  // Ownership is known only for runs the board lists; for the rest the stage decides.
  const live = new Map(tasks.flatMap((t) => (t.run ? [[t.run.id, t.run]] : [])));
  const attention = runs.map((r) => runAttention(r.stage, live.get(r.id)?.owned, live.get(r.id)?.waiting));
  return {
    openTasks: tasks.filter((t) => !t.archived_at && !CLOSED.includes(t.status)).length,
    running: attention.filter((a) => a === 'working').length,
    needsYou: attention.filter((a) => a === 'needs-you').length,
    pullRequests: runs.filter((r) => r.pr).length,
    spendThisMonth: runs
      .flatMap((r) => r.attempts ?? [])
      .filter((a) => sameMonth(a.finished_at))
      .reduce((sum, a) => sum + (a.cost_usd ?? 0), 0),
    ...(lastActivity ? { lastActivity } : {}),
  };
}
