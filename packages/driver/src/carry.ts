// Approval carry for the driver and tending: compares a new head's patch with the approved head's,
// file by file (the rule itself is `carryApproval` in core).
import { createHash } from 'node:crypto';
import {
  carryApproval,
  patchFingerprints,
  type CarryDecision,
  type CarryTrigger,
  type FileFingerprints,
  type TaskRecord,
} from '@factory/core';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export interface CarryInput {
  /** The head a person approved, or the head of the last carry. */
  approvedHead: string | undefined;
  /** The commit that wants to be pushed. */
  head: string;
  trigger: CarryTrigger;
  /** Files that trusted reviewers commented on. */
  comments: readonly string[];
  /** The profile's own protected paths, added to the defaults. */
  protectedPaths: readonly string[];
  /** The unified diff of a head against its merge base with the PR's base branch. */
  patchOf(head: string): Promise<string>;
}

/** Decides whether `head` may be pushed under the approval of `approvedHead`. Never throws. */
export async function decideCarry(input: CarryInput): Promise<CarryDecision> {
  const none = (reason: string): CarryDecision => ({
    carried: false,
    rule: 'no-approval',
    reason,
    moved: [],
  });
  if (!input.approvedHead) return none('no head of this task was approved');
  let approved: FileFingerprints;
  let candidate: FileFingerprints;
  try {
    approved = patchFingerprints(await input.patchOf(input.approvedHead), sha256);
    candidate = patchFingerprints(await input.patchOf(input.head), sha256);
  } catch (error) {
    return none(`could not compare with the approved head: ${(error as Error).message}`);
  }
  return carryApproval(approved, candidate, input.comments, input.protectedPaths, input.trigger);
}

/** The decision as it is kept on the task, for the approval gate and the receipt. */
export function carryRecord(
  decision: CarryDecision,
  input: { approvedHead: string | undefined; head: string; trigger: string; at: string },
): NonNullable<TaskRecord['approval_carry']> {
  return {
    decision: decision.carried ? 'carried' : 'waiting',
    rule: decision.rule,
    reason: decision.reason,
    trigger: input.trigger,
    ...(input.approvedHead ? { approved_head: input.approvedHead } : {}),
    head_sha: input.head,
    moved: decision.moved,
    at: input.at,
  };
}

/**
 * The head whose approval a new commit is compared with: the head a person approved, or the head of
 * a later carry when that is newer (each carried step passed the rule against the one before it).
 */
export function approvedHeadOf(task: TaskRecord): string | undefined {
  const approval = task.approval?.decision === 'approved' ? task.approval : undefined;
  const carry = task.approval_carry?.decision === 'carried' ? task.approval_carry : undefined;
  if (carry && (!approval || carry.at > approval.at)) return carry.head_sha;
  return approval?.head_sha;
}
