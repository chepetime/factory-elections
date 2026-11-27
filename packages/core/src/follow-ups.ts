// Follow-ups: more work on a run whose PR is already open, by a workspace agent, on the same branch
// and PR. The run goes through the usual stages again (coding, the approval gate with the new commit,
// then a push to the same PR), so the board shows the ticket in progress, in review or blocked, and
// nothing reaches GitHub without a person approving that exact commit, unless the commit is the
// approved patch itself (a clean base merge: see approval-carry.ts).
import type { TaskRecord } from './schemas.ts';

export type FollowUpKind = 'custom' | 'conflicts' | 'review';

/**
 * Whether the follow-up's commit may be pushed once the checks pass, without the approval gate. Only
 * the review loop's fixes may, and only when `carryApproval` shows the approved patch did not
 * change (see approval-carry.ts); any other change waits at the gate for a person.
 */
export function followUpPushesItself(kind: FollowUpKind): boolean {
  return kind === 'review';
}

/**
 * Whether a person's follow-up asks to bring the base branch in: merge or rebase on main, update
 * the branch, or resolve conflicts. Such a follow-up runs as `conflicts`: the factory merges the base
 * outside the agent sandbox (which blocks some paths a merge may touch, such as `.claude/`), and the
 * agent only resolves what conflicts. A clean merge needs no agent.
 */
export function asksForBaseMerge(note: string): boolean {
  const n = note.toLowerCase();
  return (
    /\bconflict/.test(n) ||
    /\b(merge|rebase|sync|update|bring)\b[^.\n]{0,40}\b(main|master|base|upstream|develop)\b/.test(n) ||
    /\b(main|base)\b[^.\n]{0,20}\binto (this|the) (branch|pr)\b/.test(n)
  );
}

/** The instructions of a conflict follow-up; `base` is the PR's base branch. */
export function conflictFollowUpNote(base: string): string {
  return [
    `The pull request conflicts with ${base}. The factory merged ${base} into this branch and stopped on conflicts.`,
    'Resolve every conflict so both changes keep working, remove all conflict markers, and run the tests.',
  ].join(' ');
}

/** The agent a follow-up uses when the person does not pick one: the one that did the run. */
export function followUpAgent(task: TaskRecord, assignee?: string): string | undefined {
  return (task.workflow === 'agent' ? task.agent : undefined) ?? assignee ?? task.agent;
}

/** Whether the conflict watcher already added a follow-up for this PR head. */
export function conflictFollowUpSeen(task: TaskRecord, prHead: string): boolean {
  return (task.follow_ups ?? []).some((f) => f.kind === 'conflicts' && f.pr_head === prHead);
}

/**
 * A command that brings the base branch into the task branch: merge, rebase or pull. Agents never
 * run these: the factory merges the base itself, outside the agent sandbox (which blocks writes
 * under paths such as `.claude/`, so a merge there can stop half done), and hands real conflicts
 * to the agent. Returns the refused part of the command.
 */
export function baseSyncCommand(command: string): string | undefined {
  for (const raw of command.split(/&&|\|\||;|\||\n/)) {
    const part = raw.trim();
    if (/^git\s+(merge|rebase|pull)\b/.test(part) && !/--(abort|continue|quit|skip)\b/.test(part))
      return part;
  }
  return undefined;
}

/** What an agent is told about the base branch, so it does not try to sync the branch itself. */
export const BASE_SYNC_NOTE =
  'The factory keeps this branch current with the base branch: it merges the base for you before your turn, outside your sandbox, and gives you any conflicts to resolve. Do not run git merge, rebase or pull yourself.';
