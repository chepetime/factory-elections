// One execution vocabulary for every adapter (ADR 0005). State says where an attempt is; outcome
// says how it ended; cleanup says whether its processes are known to be gone. They are separate,
// so a slow cleanup never relabels a finished result, and a known result never hides leftovers.
import { z } from 'zod';
import { ProviderId } from './agents.ts';
import type { ModelFailure } from './ports.ts';

export const ExecutionOutcome = z.enum(['completed', 'failed', 'cancelled', 'interrupted']);
export type ExecutionOutcome = z.infer<typeof ExecutionOutcome>;

/**
 * Whether an attempt's processes are known to have stopped. `uncertain` lists why, e.g. an
 * adapter that cannot stop the commands its provider started.
 */
export const CleanupRecord = z.object({
  status: z.enum(['clean', 'uncertain']),
  reasons: z.array(z.string().max(500)).max(20).optional(),
  /** When a person confirmed that nothing from an uncertain cleanup still runs. */
  confirmed_at: z.string().optional(),
});
export type CleanupRecord = z.infer<typeof CleanupRecord>;

/** What one model call reports about its own cleanup when it stops early. */
export interface CallCleanup {
  status: 'clean' | 'uncertain';
  reason?: string;
}

/** The cleanup of an attempt from the calls it made: one uncertain call makes it uncertain. */
export function combineCleanup(calls: readonly CallCleanup[]): CleanupRecord {
  const reasons = [
    ...new Set(calls.filter((c) => c.status === 'uncertain').map((c) => c.reason ?? 'unknown')),
  ];
  return reasons.length ? { status: 'uncertain', reasons: reasons.slice(0, 20) } : { status: 'clean' };
}

/**
 * Why new work on a task must wait: its last run may have left processes that still change the
 * worktree, and a new run there would race them. Undefined when nothing blocks.
 */
export function cleanupBlocker(cleanup: CleanupRecord | undefined): string | undefined {
  if (cleanup?.status !== 'uncertain' || cleanup.confirmed_at) return undefined;
  const why = cleanup.reasons?.length ? ` (${cleanup.reasons.join('; ')})` : '';
  return `The last run may have left processes running${why}. Check for them, then confirm the cleanup before a new run.`;
}

/** How long a provider session may continue: across a task, a conversation, a review, or not at all. */
export const ContinuityScope = z.enum(['task', 'conversation', 'review', 'disposable']);
export type ContinuityScope = z.infer<typeof ContinuityScope>;

/**
 * A provider's own conversation, as a reference. It gives continuity between calls; it is never
 * the identity of a Factory task, run or conversation, and it is not project memory.
 */
export const ProviderSessionRef = z.object({
  provider: ProviderId,
  native_id: z.string().min(1).max(200),
  cwd: z.string().max(4096).optional(),
  scope: ContinuityScope,
  /** The workflow step or turn that used it. */
  step: z.string().max(100).optional(),
  last_used_at: z.string(),
});
export type ProviderSessionRef = z.infer<typeof ProviderSessionRef>;

/** Adds or refreshes one session reference; the same provider and native id appear once. */
export function withSession(
  sessions: readonly ProviderSessionRef[],
  ref: ProviderSessionRef,
): ProviderSessionRef[] {
  const rest = sessions.filter((s) => !(s.provider === ref.provider && s.native_id === ref.native_id));
  return [...rest, ref].slice(-50);
}

/** The answer to extra input sent while a turn runs. The UI shows this, not "sent". */
export type SupplementReceipt =
  { status: 'accepted' } | { status: 'queued'; reason: string } | { status: 'rejected'; reason: string };

/**
 * The outcome of an attempt that ended with an error. A stop that the user or shutdown asked
 * for is `cancelled`; everything else is `failed`. Restart recovery sets `interrupted` itself.
 */
export function failureOutcome(failure: ModelFailure | undefined, stopRequested: boolean): ExecutionOutcome {
  return stopRequested || failure === 'aborted' ? 'cancelled' : 'failed';
}

/** The outcome of a run record, for records written before `outcome` existed. */
export function runOutcome(record: {
  state: string;
  outcome?: ExecutionOutcome | undefined;
}): ExecutionOutcome | undefined {
  if (record.outcome) return record.outcome;
  if (record.state === 'completed' || record.state === 'failed' || record.state === 'interrupted')
    return record.state;
  return undefined;
}
