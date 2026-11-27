// What startup recovery does with each stored state of a run and of a task stage. One table per
// record type; `satisfies Record<State, RecoveryRule>` makes the compiler refuse a new state that has
// no rule, and recovery-rules.test.ts checks the tables against the schemas at run time.
//   final       nothing to do.
//   idle        nothing is in flight; a person's command starts the next step.
//   person      a person acts; the task board or inbox says so.
//   reconciler  a named step that service-recovery.ts runs after a restart.
import type { Stage } from '@factory/core';
import type { RunRecord } from './run-record.ts';

/** `requeue`: queue a queued run again. `interrupt`: mark it interrupted; fail a working task. */
export type RecoveryStep = 'requeue' | 'interrupt';

export type RecoveryRule =
  | { kind: 'final' | 'idle' | 'person'; note: string }
  | { kind: 'reconciler'; step: RecoveryStep; note: string };

const final = (note: string): RecoveryRule => ({ kind: 'final', note });
const idle = (note: string): RecoveryRule => ({ kind: 'idle', note });
const person = (note: string): RecoveryRule => ({ kind: 'person', note });
const by = (step: RecoveryStep, note: string): RecoveryRule => ({ kind: 'reconciler', step, note });

/** `run.json` state of a task's latest run. */
export const RUN_RECOVERY = {
  queued: by('requeue', 'Queued again; if it cannot be, marked interrupted.'),
  running: by('interrupt', 'Marked interrupted with cleanup uncertain; a task at a working stage fails.'),
  completed: final('Settled.'),
  failed: final('Settled.'),
  interrupted: person('A person runs the task again; uncertain cleanup waits for a confirm.'),
} satisfies Record<RunRecord['state'], RecoveryRule>;

/** Task stage. Only `coding` and `reviewing` mean a run is working; the rest wait. */
export const STAGE_RECOVERY = {
  queued: idle('Waits for readiness; a person or the pickup starts the run.'),
  classified: idle('Waits for a person to start the run.'),
  blocked: person('Inbox: blocked. A person answers or opens a new task.'),
  coding: by('interrupt', 'No live run: the task moves to failed so a person can run it again.'),
  'verification-failed': person('Inbox: failed. A person reads the log and runs again.'),
  reviewing: by('interrupt', 'No live run: the task moves to failed so a person can run it again.'),
  'awaiting-approval': person('Inbox: gate. A person approves or rejects.'),
  approved: idle('Waits for a person to open the pull request.'),
  rejected: idle('Waits for a person to revise.'),
  'pr-opened': final('The review loop and PR tending own it from here.'),
  failed: person('Inbox: failed. A person reads the log and runs again.'),
} satisfies Record<Stage, RecoveryRule>;

/** Whether a task at this stage fails when its run is interrupted. */
export const failsWhenInterrupted = (stage: Stage): boolean => {
  const rule: RecoveryRule = STAGE_RECOVERY[stage];
  return rule.kind === 'reconciler' && rule.step === 'interrupt';
};
