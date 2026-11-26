// Review tickets: a senior PR review of someone else's PR as board work, in rounds. Each round the
// agent reviews (or re-reviews) the PR head and proposes a decision; you pick what to post, and the
// agent posts it under your account. New commits start another round, up to REVIEW_ROUND_LIMIT.
// Pure rules here; the backend runs the reviews (packages/backend/src/review-tickets.ts).
import type { Issue } from './issues.ts';

export const REVIEW_ROUND_LIMIT = 3;

export type ReviewTicket = NonNullable<Issue['review']>;
export type ReviewRound = ReviewTicket['rounds'][number];

/** One thing you can post for a decision; `text` is the message the review chat receives. */
export interface ReviewOption {
  id: 'approve' | 'comment-approve' | 'comment' | 'request-changes' | 'discussion' | 'direction' | 'nothing';
  label: string;
  /** What the review chat receives: the skill's numbered option, in its own words (§7). */
  text: string;
  /** The ticket is done once this is posted (an approval), or waits for the author. */
  done: boolean;
  tone: 'primary' | 'default' | 'danger';
}

const NOTHING: ReviewOption = { id: 'nothing', label: 'Post nothing', text: '', done: true, tone: 'default' };

/** The options the senior-pr-review skill offers for a decision (its §7 table), plus "post nothing". */
export function reviewOptions(decision: string | undefined): ReviewOption[] {
  const d = (decision ?? '').toLowerCase();
  if (d === 'approve')
    return [
      { id: 'approve', label: 'Approve', text: '1. Approve the PR.', done: true, tone: 'primary' },
      NOTHING,
    ];
  if (d === 'comment')
    return [
      {
        id: 'comment-approve',
        label: 'Approve with comments',
        text: '1. Post the comments and approve.',
        done: true,
        tone: 'primary',
      },
      {
        id: 'comment',
        label: 'Comment only',
        text: '2. Post the comments only.',
        done: false,
        tone: 'default',
      },
      NOTHING,
    ];
  if (d === 'request changes')
    return [
      {
        id: 'request-changes',
        label: 'Request changes',
        text: '1. Post the comments and request changes.',
        done: false,
        tone: 'danger',
      },
      {
        id: 'comment',
        label: 'Comment only',
        text: '2. Post the comments only.',
        done: false,
        tone: 'default',
      },
      NOTHING,
    ];
  if (d === 'needs discussion')
    return [
      {
        id: 'discussion',
        label: 'Ask the question',
        text: '1. Post the confirmation question as a comment.',
        done: false,
        tone: 'primary',
      },
      NOTHING,
    ];
  if (d === 'needs attention')
    return [
      {
        id: 'direction',
        label: 'Request changes on the approach',
        text: '1. Post the direction finding and request changes.',
        done: false,
        tone: 'danger',
      },
      NOTHING,
    ];
  return [NOTHING];
}

/** The latest round, when the ticket has one. */
export const lastRound = (review: ReviewTicket): ReviewRound | undefined => review.rounds.at(-1);

/** A round that started and has not ended: its review or its posting still runs. */
export function roundRunning(round: ReviewRound | undefined): boolean {
  if (!round) return false;
  if (!round.ended_at) return true;
  return Boolean(round.posted && !round.posted.done_at && round.posted.option !== 'nothing');
}

export type ReviewWatchStep =
  | { kind: 'none' }
  | { kind: 'ended'; state: 'MERGED' | 'CLOSED' }
  | { kind: 'rereview' }
  /** New commits after the last allowed round: say so once, and wait for a person. */
  | { kind: 'limit' };

/** What the ticket does after the PR changed on GitHub: merged or closed, or new commits. */
export function reviewWatchStep(
  review: ReviewTicket,
  pr: { state: 'OPEN' | 'MERGED' | 'CLOSED'; head_sha?: string },
): ReviewWatchStep {
  if (pr.state !== 'OPEN') return { kind: 'ended', state: pr.state };
  const round = lastRound(review);
  if (!round || roundRunning(round) || !pr.head_sha || !round.head_sha || round.head_sha === pr.head_sha)
    return { kind: 'none' };
  if (review.rounds.length >= REVIEW_ROUND_LIMIT)
    return review.limit_noted_head === pr.head_sha ? { kind: 'none' } : { kind: 'limit' };
  return { kind: 'rereview' };
}
