// Who has the next move on a run: the factory, a person, or nobody. One answer for the sidebar,
// the board cards and the home numbers, so a run never shows as working in one and waiting in another.
import type { Stage } from './schemas.ts';

/** The name of each stage for a person. Every screen reads this one list. */
export const STAGE_LABELS: Record<Stage, string> = {
  queued: 'Queued',
  classified: 'Classified',
  coding: 'Coding',
  reviewing: 'Reviewing',
  'awaiting-approval': 'Awaiting approval',
  'verification-failed': 'Checks failed',
  approved: 'Approved',
  'pr-opened': 'PR opened',
  blocked: 'Blocked',
  failed: 'Failed',
  rejected: 'Rejected',
};

export function stageLabel(stage: Stage): string {
  return STAGE_LABELS[stage];
}

export type RunAttention =
  /** The factory works on it now. */
  | 'working'
  /** A person decides: review the change, or open its pull request. Routine, not a problem. */
  | 'review'
  /** The run stopped for a person's reply: a question, a spent budget, conflicts. Replying continues it. */
  | 'reply'
  /** Something went wrong: failed, checks failed, or interrupted. A person reads it and starts it again. */
  | 'problem'
  /** Created, not started yet. */
  | 'waiting'
  /** Its pull request is open. */
  | 'done'
  /** Rejected. */
  | 'closed';

/** The states where a person has the next move, most urgent first. */
export const PERSON_ATTENTION = ['problem', 'reply', 'review'] as const;
export type PersonAttention = (typeof PERSON_ATTENTION)[number];

/** Each person state's name, for group headings and counts. */
export const ATTENTION_LABELS: Record<PersonAttention, string> = {
  problem: 'Problem',
  reply: 'Needs a reply',
  review: 'To review',
};

export function needsPerson(attention: RunAttention): attention is PersonAttention {
  return (PERSON_ATTENTION as readonly string[]).includes(attention);
}

const BY_STAGE: Record<Stage, RunAttention> = {
  queued: 'waiting',
  classified: 'waiting',
  coding: 'working',
  reviewing: 'working',
  'awaiting-approval': 'review',
  approved: 'review',
  blocked: 'reply',
  failed: 'problem',
  'verification-failed': 'problem',
  'pr-opened': 'done',
  rejected: 'closed',
};

const NEEDS: Partial<Record<Stage, string>> = {
  'awaiting-approval': 'review',
  approved: 'open PR',
  blocked: 'reply',
  failed: 'failed',
  'verification-failed': 'checks failed',
};

/**
 * `owned` says whether a live run holds the task, when the caller knows it. A live run always
 * works, whatever the stage (a revision of a failed run). A coding or reviewing stage with no
 * live run was interrupted: a problem a person must start again. Without `owned` the stage decides.
 * `waiting` says a new turn is queued until its agent is free: nobody has a move yet.
 */
export function runAttention(stage: Stage, owned?: boolean, waiting?: boolean): RunAttention {
  if (waiting) return 'waiting';
  if (owned) return stage === 'pr-opened' || stage === 'rejected' ? BY_STAGE[stage] : 'working';
  if (owned === false && BY_STAGE[stage] === 'working') return 'problem';
  return BY_STAGE[stage];
}

/** A short reason a run needs a person, such as "review" or "interrupted". */
export function runNeed(stage: Stage, owned?: boolean, waiting?: boolean): string | undefined {
  if (!needsPerson(runAttention(stage, owned, waiting))) return undefined;
  return NEEDS[stage] ?? 'interrupted';
}
