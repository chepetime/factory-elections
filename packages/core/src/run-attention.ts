// Who has the next move on a run: the factory, a person, or nobody. One answer for the sidebar,
// the board cards and the home numbers, so a run never shows as working in one and waiting in another.
import type { Stage } from './schemas.ts';

export type RunAttention =
  /** The factory works on it now. */
  | 'working'
  /** A person has the next move: review, open the pull request, answer, or start it again. */
  | 'needs-you'
  /** Created, not started yet. */
  | 'waiting'
  /** Its pull request is open. */
  | 'done'
  /** Rejected. */
  | 'closed';

const BY_STAGE: Record<Stage, RunAttention> = {
  queued: 'waiting',
  classified: 'waiting',
  coding: 'working',
  reviewing: 'working',
  'awaiting-approval': 'needs-you',
  approved: 'needs-you',
  blocked: 'needs-you',
  failed: 'needs-you',
  'verification-failed': 'needs-you',
  'pr-opened': 'done',
  rejected: 'closed',
};

const NEEDS: Partial<Record<Stage, string>> = {
  'awaiting-approval': 'review',
  approved: 'open PR',
  blocked: 'blocked',
  failed: 'failed',
  'verification-failed': 'checks failed',
};

/**
 * `owned` says whether a live run holds the task, when the caller knows it. A live run always
 * works, whatever the stage (a revision of a failed run). A coding or reviewing stage with no
 * live run was interrupted: a person must start it again. Without `owned` the stage decides.
 * `waiting` says a new turn is queued until its agent is free: nobody has a move yet.
 */
export function runAttention(stage: Stage, owned?: boolean, waiting?: boolean): RunAttention {
  if (waiting) return 'waiting';
  if (owned) return stage === 'pr-opened' || stage === 'rejected' ? BY_STAGE[stage] : 'working';
  if (owned === false && BY_STAGE[stage] === 'working') return 'needs-you';
  return BY_STAGE[stage];
}

/** A short reason a run needs a person, such as "review" or "interrupted". */
export function runNeed(stage: Stage, owned?: boolean, waiting?: boolean): string | undefined {
  if (runAttention(stage, owned, waiting) !== 'needs-you') return undefined;
  return NEEDS[stage] ?? 'interrupted';
}
