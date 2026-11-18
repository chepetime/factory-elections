// The small, often-read part of a task page: the active run's output and activity, plus a
// version of everything else. The page reloads only when that version changes.
import { createHash } from 'node:crypto';
import { executionBusy, type ExecutionPhase, type TaskRecord } from '@factory/core';
import { backgroundRun, readTaskControls, type BackgroundRun } from '@/lib/factory';

/** A failed observation must never unlock a command or pretend a worker is alive. */
export function taskPhase(execution: ExecutionPhase, run: BackgroundRun): ExecutionPhase {
  if (execution === 'unavailable' || run.phase === 'unavailable') return 'unavailable';
  if (executionBusy(execution)) return execution;
  return run.phase ?? execution;
}

/** Changes when anything the page shows, other than live output and activity, changes. */
export function pageVersion(task: TaskRecord, phase: ExecutionPhase, label: string | undefined): string {
  return createHash('sha1').update(JSON.stringify({ task, phase, label })).digest('hex').slice(0, 16);
}

export interface LiveRun {
  version: string;
  busy: boolean;
  logTail?: string;
  activity?: BackgroundRun['activity'];
}

export async function readLiveRun(project: string, id: string): Promise<LiveRun | undefined> {
  const [controls, run] = await Promise.all([readTaskControls(project, id), backgroundRun(project, id)]);
  if (!controls.ok) return undefined;
  const phase = taskPhase(controls.value.execution, run);
  return {
    version: pageVersion(controls.value.task, phase, run.label),
    busy: executionBusy(phase),
    logTail: run.logTail,
    activity: run.activity,
  };
}
