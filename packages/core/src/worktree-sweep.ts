// Idle worktree sweep rules. Pure: the caller gathers the facts (git state, running agents) and
// acts on the verdict, so a dry run and a real sweep use the same decision.

export const DEFAULT_WORKTREE_IDLE_HOURS = 24;

export interface WorktreeFacts {
  /** The task's stage. `rejected` is finished work. */
  stage: string;
  archived?: boolean;
  /** State of the task's PR, when it has one. */
  pr?: 'open' | 'merged' | 'closed';
  /** When the task last changed (ISO). */
  updated_at?: string;
  /** Whether the worktree directory is still there. */
  exists: boolean;
  /** `git status` shows uncommitted changes. */
  dirty: boolean;
  /** Commits on the branch that no remote has. */
  unpushed_commits: number;
  /** An agent run holds the task. */
  agent_running: boolean;
}

export type WorktreeVerdict =
  | { action: 'remove' }
  | { action: 'keep'; reason: 'no-worktree' | 'not-finished' | 'not-idle-yet' }
  /** Finished and idle, but removing it would lose work or stop an agent: tell a person. */
  | { action: 'report'; reason: 'uncommitted-changes' | 'unpushed-commits' | 'agent-running' };

/** Whether the task's work is over: rejected, archived, or its PR merged or closed. */
export function isFinishedTask(f: Pick<WorktreeFacts, 'stage' | 'archived' | 'pr'>): boolean {
  return f.stage === 'rejected' || f.archived === true || f.pr === 'merged' || f.pr === 'closed';
}

/** Hours before a finished task's worktree goes; anything not a positive number is the default. */
export function idleHours(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_WORKTREE_IDLE_HOURS;
}

export function worktreeVerdict(
  f: WorktreeFacts,
  now: Date,
  hours = DEFAULT_WORKTREE_IDLE_HOURS,
): WorktreeVerdict {
  if (!f.exists) return { action: 'keep', reason: 'no-worktree' };
  if (!isFinishedTask(f)) return { action: 'keep', reason: 'not-finished' };
  const since = f.updated_at ? Date.parse(f.updated_at) : NaN;
  // A task with no usable timestamp is never swept: its age is unknown.
  if (!Number.isFinite(since) || now.getTime() - since < hours * 3_600_000)
    return { action: 'keep', reason: 'not-idle-yet' };
  if (f.agent_running) return { action: 'report', reason: 'agent-running' };
  if (f.dirty) return { action: 'report', reason: 'uncommitted-changes' };
  if (f.unpushed_commits > 0) return { action: 'report', reason: 'unpushed-commits' };
  return { action: 'remove' };
}
