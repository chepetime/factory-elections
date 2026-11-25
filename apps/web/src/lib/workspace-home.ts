// Numbers for one project card on the app homepage, from its runs and board tasks.
import type { Issue, IssueStatus, Stage, TaskRecord } from '@factory/core';
import { NEEDS_YOU } from '@/lib/overview';

const RUNNING: Stage[] = ['queued', 'classified', 'coding', 'reviewing'];
const CLOSED: IssueStatus[] = ['done', 'cancelled'];

export interface ProjectStats {
  /** Board tasks that are not archived, done or cancelled. */
  openTasks: number;
  /** Runs the factory is working on. */
  running: number;
  /** Runs that wait for a person: approval, a blocker or a failure. */
  needsYou: number;
  /** Runs that opened a pull request, all time. */
  pullRequests: number;
  /** Model spend of runs that finished this calendar month. */
  spendThisMonth: number;
  /** The newest update of any run or board task. */
  lastActivity?: string;
}

type BoardTask = Pick<Issue, 'status' | 'updated_at'> & { archived_at?: string | undefined };

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
  return {
    openTasks: tasks.filter((t) => !t.archived_at && !CLOSED.includes(t.status)).length,
    running: runs.filter((r) => RUNNING.includes(r.stage)).length,
    needsYou: runs.filter((r) => NEEDS_YOU.includes(r.stage)).length,
    pullRequests: runs.filter((r) => r.pr).length,
    spendThisMonth: runs
      .flatMap((r) => r.attempts ?? [])
      .filter((a) => sameMonth(a.finished_at))
      .reduce((sum, a) => sum + (a.cost_usd ?? 0), 0),
    ...(lastActivity ? { lastActivity } : {}),
  };
}
