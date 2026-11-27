// Clears the git locks a dead process left in a task worktree before a resumed run's first git
// command. The backend turns this on (`deps.staleLocks`) only for a run that follows an interrupted
// one whose cleanup is clean or confirmed: while a cleanup is uncertain, an old git may still live.
import type { TaskRecord } from '@factory/core';
import type { DriverDeps } from './ports.ts';

export async function clearStaleLocks(deps: DriverDeps, task: TaskRecord): Promise<void> {
  const { staleLocks, git, log } = deps;
  if (!staleLocks || !git.clearStaleGitLocks || !task.worktree) return;
  try {
    const report = await git.clearStaleGitLocks(deps.tasks.worktreePath(task.project, task.id), {
      branch: task.worktree.branch,
      olderThan: staleLocks.olderThan,
    });
    for (const path of report.removed) log(`Removed stale git lock ${path}`);
    for (const { path, reason } of report.kept) log(`Left git lock ${path}: ${reason}`);
    if (report.reported.length) {
      log(`Found git locks that are not this task's; left for you to check: ${report.reported.join(', ')}`);
      staleLocks.reported?.(task, report.reported);
    }
  } catch (error) {
    // A failed look must not stop the run: a lock that is really there fails its git command anyway.
    log(`Could not check for stale git locks: ${error instanceof Error ? error.message : String(error)}`);
  }
}
