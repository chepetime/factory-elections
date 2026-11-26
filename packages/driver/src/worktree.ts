// The task's worktree, checked: it exists, belongs to the task's repository, and is on the task branch.
import { type TaskRecord } from '@factory/core';
import { DriverError, type DriverDeps } from './ports.ts';

export async function checkedWorktree(
  deps: DriverDeps,
  task: TaskRecord,
): Promise<{ path: string; branch: string; base: string }> {
  const { git } = deps;
  const path = deps.tasks.worktreePath(task.project, task.id);
  const branch = `factory/${task.id}`;
  if (!(await deps.definitions.exists(path))) throw new DriverError(`task worktree does not exist: ${path}`);
  const [worktreeRepo, taskRepo] = await Promise.all([git.commonRepo(path), git.commonRepo(task.repo)]);
  if (!worktreeRepo || worktreeRepo !== taskRepo)
    throw new DriverError('task worktree does not belong to the task repository');
  if ((await git.currentBranch(path)) !== branch)
    throw new DriverError(`task worktree is not on branch ${branch}`);
  const base = task.worktree?.base_branch ?? (await deps.readProfile(task.project)).repo.base_branch.value;
  return { path, branch, base };
}
