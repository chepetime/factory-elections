# Recovery rules for runs and task stages

Part of [the state-machine index](../state-machines.md).

After a restart `reconcileTask` (`service-recovery.ts`) reads the task's latest run and acts through `RUN_RECOVERY` and `STAGE_RECOVERY` (`recovery-rules.ts`). Each table is `satisfies Record<State, RecoveryRule>`, so a new state does not compile until it names a rule; `recovery-rules.test.ts` checks the tables against the zod enums. Rule kinds: `final` (settled), `idle` (a person's command starts the next step), `person` (a person acts), `reconciler` (a named step).

| Run state | Rule | Step |
| --- | --- | --- |
| `queued` | reconciler `requeue` | Queued again; if that is refused, marked `interrupted`. |
| `running` | reconciler `interrupt` | Marked `interrupted`, cleanup `uncertain`; a task at `coding` or `reviewing` goes to `failed`. |
| `completed`, `failed` | final | Settled. |
| `interrupted` | person | A person runs the task again; uncertain cleanup waits for a confirm. |

| Task stage | Rule | Step |
| --- | --- | --- |
| `queued`, `classified`, `approved`, `rejected` | idle | Waits for a person's command or the pickup. |
| `coding`, `reviewing` | reconciler `interrupt` | With no live run the task moves to `failed`. |
| `blocked`, `verification-failed`, `awaiting-approval`, `failed` | person | The inbox or board shows it. |
| `pr-opened` | final | The review loop and PR tending own it. |

### Stale git locks after an interrupted run

A backend killed during a git command leaves a lock file (`index.lock`) that fails the next git command with "File exists". The task worktree is linked, so its own index lives in the common repository's `worktrees/<name>/` directory, next to the person's checkout and other worktrees. The rule:

- `reconcileTask` never touches locks: while cleanup is `uncertain`, a git process of the old run may still live.
- `start` marks the new run `after_interrupted` when the task's previous run is `interrupted` and `cleanupBlocker` passed (cleanup clean or confirmed). Only such a run clears locks.
- `setupWorktree` (the driver, before the first git command on `task.worktree`) calls `clearStaleGitLocks` (`adapters-git`). It removes `index.lock`, `HEAD.lock` and `ORIG_HEAD.lock` in the worktree's own git directory, and `refs/heads/<task branch>.lock` in the common directory.
- A lock goes only if its mtime is older than this backend's start and no live `git` process has the worktree as its working directory (`lsof -a -c git -d cwd`, injectable as `liveGit`). If the probe fails, the lock stays.
- Each removed or kept path is logged to the run's evidence.
- Every other lock (`packed-refs.lock`, `config.lock`, other refs, the main worktree's `index.lock`, other worktrees') is reported to the recovery inbox and never removed. The inbox item is in memory: a restart drops it until the next resumed run finds the lock again.
- Review worktrees (`packages/pr-reviews`) have the same risk and do not clear locks yet.

Not covered yet: only the latest run of a task is read, so an older run left `running` is never settled; the review, review-loop, feature, ticket and `working`-flag states have no table; nothing reports a record that no owner holds.
