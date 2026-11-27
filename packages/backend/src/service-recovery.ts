// Shutdown and restart recovery for the backend: drain the runs, then recover, reconcile and
// requeue them. BackendService methods of the same names call these.
import {
  cleanupBlocker,
  taskCommandBlockers,
  withStage,
  type TaskRecord,
  type RecoveryProblem,
  type RecoveryReport,
} from '@factory/core';
import { ownerOf, RunRecord, writeRun } from './run-record.ts';
import { Conflict } from './conflict.ts';
import { RUN_RECOVERY, failsWhenInterrupted } from './recovery-rules.ts';
import { DRAIN_GRACE_MS, type BackendService } from './service.ts';

const RECOVERY_RETRY_MS = Number(process.env.FACTORY_RECOVERY_RETRY_MS ?? 30_000);
const INTERRUPTED =
  'The backend stopped during this run. Run the task again to continue from the last saved step.';

/**
 * Stops acceptance, lets the active run finish for `graceMs`, then stops its model calls and
 * checks. Queued runs that have not started stay queued for the next start.
 */
export async function drain(s: BackendService, graceMs = DRAIN_GRACE_MS): Promise<void> {
  // Waiting runs see the shutdown now and stay queued for the next start.
  s.dispatcher.close();
  clearTimeout(s.recoveryRetry);
  s.pickup.stop();
  s.profileChecks.stopAll();
  const deadline = setTimeout(() => {
    s.executor.abortAll();
  }, graceMs);
  try {
    // Acceptance already in flight may be reserving a lock or writing its durable record.
    await Promise.all([s.dispatcher.drained(), s.executions.drain(graceMs)]);
  } finally {
    clearTimeout(deadline);
  }
}

export function recoveryReport(s: BackendService): RecoveryReport {
  return s.recovery;
}

/**
 * After a restart: a run that was running is marked interrupted and its task made resumable; a
 * run that never started is queued again. Call once, while s service owns the data root. A
 * project or task it cannot read goes into the recovery report, and it is retried until it
 * succeeds.
 */
export async function recover(
  s: BackendService,
): Promise<{ requeued: number; interrupted: number; problems: number }> {
  const counts = { requeued: 0, interrupted: 0, problems: 0 };
  const problems: RecoveryProblem[] = [];
  const failed = (project: string, error: unknown, task_id?: string) =>
    problems.push({
      project,
      ...(task_id ? { task_id } : {}),
      error: error instanceof Error ? error.message : String(error),
      since: s.problemSince(project, task_id),
    });
  let projects: { name: string }[] = [];
  try {
    projects = await s.projects.list();
  } catch (error) {
    failed('*', error);
  }
  for (const project of projects) {
    let tasks: TaskRecord[];
    try {
      tasks = await s.tasks.list(project.name);
    } catch (error) {
      failed(project.name, error);
      continue;
    }
    for (const task of tasks) {
      try {
        const result = await s.reconcileTask(project.name, task.id);
        if (result) counts[result]++;
      } catch (error) {
        failed(project.name, error, task.id);
      }
    }
  }
  counts.problems = problems.length;
  s.finishRecovery(problems);
  return counts;
}

/** Reconciles only what the last recovery could not read. Safe to call again at any time. */
export async function reconcile(s: BackendService): Promise<RecoveryReport> {
  if (s.recovery.state !== 'degraded') return s.recovery;
  const problems: RecoveryProblem[] = [];
  for (const problem of s.recovery.problems) {
    try {
      if (problem.project === '*') {
        await s.recover();
        return s.recovery;
      }
      const ids = problem.task_id
        ? [problem.task_id]
        : (await s.tasks.list(problem.project)).map((t) => t.id);
      for (const id of ids) {
        try {
          await s.reconcileTask(problem.project, id);
        } catch (error) {
          problems.push({
            ...problem,
            task_id: id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      problems.push({ ...problem, error: error instanceof Error ? error.message : String(error) });
    }
  }
  s.finishRecovery(problems);
  return s.recovery;
}

export function problemSince(s: BackendService, project: string, task_id?: string): string {
  return (
    s.recovery.problems.find((p) => p.project === project && p.task_id === task_id)?.since ??
    new Date().toISOString()
  );
}

export function finishRecovery(s: BackendService, problems: RecoveryProblem[]): void {
  s.recovery = {
    state: problems.length ? 'degraded' : 'ok',
    checked_at: new Date().toISOString(),
    problems,
  };
  clearTimeout(s.recoveryRetry);
  s.recoveryRetry = undefined;
  if (problems.length && s.dispatcher.accepting) {
    s.recoveryRetry = setTimeout(() => void s.reconcile().catch(() => undefined), RECOVERY_RETRY_MS);
    s.recoveryRetry.unref();
  }
}

/**
 * Settles one task's latest run if no live owner holds it: queued again, or interrupted. Throws
 * when the run cannot be read, so the caller reports it. A missing run is not an error.
 */
export async function reconcileTask(
  s: BackendService,
  project: string,
  id: string,
): Promise<'requeued' | 'interrupted' | undefined> {
  const target = { project, id };
  const latest = await s.latest(target);
  if (!latest || s.dispatcher.active(latest.record.id)) return undefined;
  const { record, dir } = latest;
  const rule = RUN_RECOVERY[record.state];
  if (rule.kind !== 'reconciler') return undefined;
  await s.tasks.clearDeadLock(project, id);
  if (rule.step === 'requeue') {
    const queued = await s.requeue(record, dir);
    if (queued === 'scheduled') return 'requeued';
    if (queued === 'settled') return undefined;
  }
  const settled = await writeRun(
    s.storage,
    dir,
    {
      ...record,
      owner_generation: s.generation,
      state: 'interrupted',
      outcome: 'interrupted',
      // Processes of a run that was running at a crash are not known to be gone.
      ...(record.state === 'running'
        ? { cleanup: { status: 'uncertain', reasons: ['the backend stopped while the run was running'] } }
        : {}),
      error: record.state === 'queued' ? 'The run could not be queued again after a restart.' : INTERRUPTED,
      finished_at: new Date().toISOString(),
    },
    ownerOf(record),
  );
  // Another backend settled this run first: leave the task to it.
  if (!settled.written) return undefined;
  const current = await s.tasks.read(project, id);
  if (failsWhenInterrupted(current.stage))
    await s.tasks.write(withStage(current, new Date().toISOString(), 'failed', INTERRUPTED));
  return 'interrupted';
}

/**
 * Queues a recovered run again. `settled`: under the task lock the run turned out to be owned or
 * no longer queued, so nothing is done. `refused`: it cannot run again.
 */
export async function requeue(
  s: BackendService,
  record: RunRecord,
  dir: string,
): Promise<'scheduled' | 'settled' | 'refused'> {
  const reservation = s.dispatcher.reserve();
  if (!reservation) return 'refused';
  let release: (() => Promise<void>) | undefined;
  try {
    release = await s.tasks.acquireLock(record.project, record.task_id);
    // Read again under the lock: a start in s process may have written and scheduled it.
    const fresh = await s.latest({ project: record.project, id: record.task_id });
    if (
      !fresh ||
      fresh.record.id !== record.id ||
      fresh.record.state !== 'queued' ||
      s.dispatcher.active(record.id)
    ) {
      reservation();
      await release();
      return 'settled';
    }
    const task = await s.tasks.read(record.project, record.task_id);
    if (taskCommandBlockers(task, record.action).length) throw new Error('blocked');
    s.schedule(record.command, record, dir, release, reservation);
    return 'scheduled';
  } catch {
    reservation();
    await release?.();
    return 'refused';
  }
}

/**
 * Called when a run is accepted. Refuses it while the task's previous run may have left processes
 * (an uncertain cleanup nobody confirmed). Otherwise says whether that run was interrupted: only
 * then can a dead process have left a stale git lock, and the new run clears the worktree's own
 * (the driver's stale-locks.ts; docs/state-machines.md).
 */
export async function resumeCheck(
  s: BackendService,
  target: Parameters<BackendService['latest']>[0],
): Promise<{ after_interrupted?: true }> {
  const previous = (await s.latest(target))?.record;
  const waiting = cleanupBlocker(previous?.cleanup);
  if (waiting) throw new Conflict(waiting);
  return previous?.state === 'interrupted' ? { after_interrupted: true } : {};
}
