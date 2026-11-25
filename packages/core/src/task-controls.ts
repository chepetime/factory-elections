// Task stage is durable workflow progress. Execution is live ownership, not a stage.
import { z } from 'zod';
import { STAGES, TaskRecord, type Stage } from './schemas.ts';
import { approvalBlockers, blockingFindings, openPrBlockers } from './domain.ts';
import { cleanupBlocker, type CleanupRecord } from './execution.ts';

export const TaskCommand = z.enum(['run', 'revise', 'approve', 'reject', 'open-pr']);
export type TaskCommand = z.infer<typeof TaskCommand>;
export const ExecutionPhase = z.enum([
  'idle',
  'queued',
  'running',
  'finalizing',
  'completed',
  'failed',
  'interrupted',
  'unavailable',
]);
export type ExecutionPhase = z.infer<typeof ExecutionPhase>;

/** Derive ownership without rewriting legacy run records, including crash recovery. */
export function executionPhase(
  state: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | undefined,
  owned: boolean,
): ExecutionPhase {
  if (owned) return state === 'queued' ? 'queued' : state === 'running' ? 'running' : 'finalizing';
  if (state === 'queued' || state === 'running') return 'interrupted';
  return state ?? 'idle';
}

export function executionBusy(phase: ExecutionPhase): boolean {
  return phase === 'queued' || phase === 'running' || phase === 'finalizing';
}

const Blocker = z.object({
  code: z.enum([
    'pr-open',
    'stage',
    'worktree-required',
    'head-unavailable',
    'gate',
    'busy',
    'unavailable',
    'cleanup',
  ]),
  message: z.string(),
});
export type CommandBlocker = z.infer<typeof Blocker>;

const COMMAND_STAGES: Record<TaskCommand, readonly Stage[]> = {
  run: ['queued', 'classified', 'blocked', 'coding', 'verification-failed', 'reviewing', 'failed'],
  revise: ['awaiting-approval', 'verification-failed', 'failed', 'rejected', 'approved'],
  approve: ['awaiting-approval'],
  reject: STAGES,
  'open-pr': ['approved'],
};
/** Whether a task in `stage` accepts `command`, before the worktree, lock and PR checks. */
export function commandAllowedIn(command: TaskCommand, stage: Stage): boolean {
  return COMMAND_STAGES[command].includes(stage);
}
const COMMAND_RESULT: Record<TaskCommand, string> = {
  run: 'run; use revise for requested changes',
  revise: 'revised',
  approve: 'approved',
  reject: 'rejected',
  'open-pr': 'opened as a pull request',
};

/** Structural guards shared by the offline driver, scheduler and action discovery. */
export function taskCommandBlockers(task: TaskRecord, action: TaskCommand): CommandBlocker[] {
  if (task.pr || task.stage === 'pr-opened')
    return [{ code: 'pr-open', message: 'A pull request is already open for this task.' }];
  if (action !== 'run' && !task.worktree)
    return [{ code: 'worktree-required', message: 'The task has no worktree.' }];
  if (!COMMAND_STAGES[action].includes(task.stage))
    return [{ code: 'stage', message: `Task at ${task.stage} cannot be ${COMMAND_RESULT[action]}.` }];
  return [];
}

export const ActionAvailability = z.object({
  action: TaskCommand,
  allowed: z.boolean(),
  blockers: z.array(Blocker),
  requires: z.array(z.enum(['note', 'head', 'accept_blocking'])),
});
export const TaskControls = z.object({
  task: TaskRecord,
  execution: ExecutionPhase,
  head_sha: z.string().optional(),
  diff_stat: z.string().optional(),
  gate_error: z.string().optional(),
  actions: z.array(ActionAvailability),
});
export type TaskControls = z.infer<typeof TaskControls>;

/** Advisory snapshot only: commands still lock and recheck the live worktree before acting. */
export function taskActions(
  task: TaskRecord,
  phase: ExecutionPhase,
  headSha?: string,
  /** The latest run's cleanup: an unconfirmed uncertain one blocks run and revise. */
  cleanup?: CleanupRecord,
) {
  const waiting = cleanupBlocker(cleanup);
  return TaskCommand.options.map((action): z.infer<typeof ActionAvailability> => {
    const blockers = taskCommandBlockers(task, action);
    if (waiting && (action === 'run' || action === 'revise'))
      blockers.push({ code: 'cleanup', message: waiting });
    if (executionBusy(phase)) blockers.unshift({ code: 'busy', message: 'A run still owns this task.' });
    if (phase === 'unavailable')
      blockers.unshift({
        code: 'unavailable',
        message: 'Execution status is unavailable. Refresh before acting.',
      });
    if ((action === 'approve' || action === 'open-pr') && blockers.length === 0) {
      if (!headSha)
        blockers.push({
          code: 'head-unavailable',
          message: 'The current worktree commit could not be checked.',
        });
      else
        for (const message of (action === 'approve' ? approvalBlockers : openPrBlockers)(task, headSha))
          blockers.push({ code: 'gate', message });
    }
    const requires: z.infer<typeof ActionAvailability>['requires'] = [];
    if (action === 'revise' || action === 'reject') requires.push('note');
    if (action === 'approve') {
      requires.push('head');
      if (blockingFindings(task)) requires.push('accept_blocking');
    }
    return { action, allowed: blockers.length === 0, blockers, requires };
  });
}
