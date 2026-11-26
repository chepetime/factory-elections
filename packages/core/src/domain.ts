// Pure task rules: readiness, gates and record updates. No I/O; time is passed in.
import { receiptClaims, receiptMarkdown } from './receipt.ts';
import type { ClassifierVerdict, ReadinessDecision, RepoProfile, Stage, TaskRecord } from './schemas.ts';
import type { ModelFailure } from './ports.ts';

export function readinessDecision(verdict: ClassifierVerdict): ReadinessDecision {
  if (verdict.kind === 'unsupported') return { action: 'unsupported' };
  switch (verdict.readiness) {
    case 'ready':
      return { action: verdict.kind === 'research' ? 'research' : 'continue' };
    case 'needs-research':
      return { action: 'research' };
    case 'needs-clarification':
      return { action: 'ask-human' };
    case 'needs-slicing':
      return { action: 'slice' };
  }
}

export function withEvent(task: TaskRecord, now: string, kind: string, message: string): TaskRecord {
  return { ...task, updated_at: now, events: [...(task.events ?? []), { at: now, kind, message }] };
}

export function withStage(task: TaskRecord, now: string, stage: Stage, message: string): TaskRecord {
  return withEvent({ ...task, stage }, now, `stage:${stage}`, message);
}

/** Reasons the human approval gate cannot be offered yet; empty when the task may be approved. */
export function approvalBlockers(task: TaskRecord, headSha: string): string[] {
  const reasons: string[] = [];
  if (!task.worktree) reasons.push('the task has no worktree');
  if (!task.verification?.passed) reasons.push('verification has not passed');
  else if (task.verification.head_sha !== headSha) reasons.push('verification is for an older commit');
  // An agent run has no reviewer step; the person reviews the change before approving it.
  if (task.workflow !== 'agent') {
    if (!task.review) reasons.push('the reviewer has not reviewed the change');
    else if (task.review.head_sha !== headSha) reasons.push('the review is for an older commit');
  }
  // After a follow-up the PR is open with an older commit; only the same commit is already in it.
  if (task.pr?.head_sha === headSha) reasons.push('the pull request already has this commit');
  return reasons;
}

export function blockingFindings(task: TaskRecord): number {
  return (task.review?.findings ?? []).filter((f) => f.severity === 'blocking').length;
}

/** Reasons a pull request must not be opened; empty when every gate is satisfied at headSha. */
export function openPrBlockers(task: TaskRecord, headSha: string): string[] {
  const reasons = approvalBlockers(task, headSha);
  if (!task.approval || task.approval.decision !== 'approved')
    reasons.push('a human has not approved the change');
  else if (task.approval.head_sha !== headSha) reasons.push('the approval is for an older commit');
  if (task.stage !== 'approved') reasons.push(`the task stage is "${task.stage}", not "approved"`);
  return reasons;
}

/** Matches a repository-relative path against a forbidden pattern: exact path, directory prefix "dir/" or "*" glob. */
export function isForbiddenPath(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith('/')) return path === pattern.slice(0, -1) || path.startsWith(pattern);
    if (pattern.includes('*')) {
      const source = pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*');
      return new RegExp(`^${source}$`).test(path);
    }
    return path === pattern;
  });
}

/** Directories whose contents are build output, caches or tool reports, wherever they appear. */
export const GENERATED_DIRS = [
  'node_modules',
  '.next',
  '.turbo',
  'coverage',
  'storybook-static',
  'test-results',
];
/** File names or suffixes that are build output or OS litter, wherever they appear. */
export const GENERATED_FILES = ['.tsbuildinfo', '.DS_Store'];

/** Whether a repository path is generated output that a change should not commit. */
export function isGeneratedPath(path: string, extraPaths: string[] = []): boolean {
  const parts = path.split('/');
  const name = parts.at(-1) ?? '';
  return (
    extraPaths.some((entry) => {
      const prefix = entry.replace(/^\.\//, '').replace(/\/+$/, '');
      return prefix.length > 0 && (path === prefix || path.startsWith(`${prefix}/`));
    }) ||
    parts.slice(0, -1).some((part) => GENERATED_DIRS.includes(part)) ||
    GENERATED_FILES.some((suffix) => name.endsWith(suffix))
  );
}

const ALWAYS_FORBIDDEN_COMMANDS = [
  'git push',
  'gh ',
  'git remote',
  'git config',
  'git checkout',
  'git switch',
  'git reset --hard',
  'git worktree',
];

/** True when a shell command contains a command the coder must never run. */
export function isForbiddenCommand(command: string, profile: RepoProfile): string | undefined {
  const normalized = command.replace(/\s+/g, ' ');
  return [...ALWAYS_FORBIDDEN_COMMANDS, ...profile.confirmed.forbidden_commands].find(
    (forbidden) => forbidden.trim() && normalized.includes(forbidden.trim()),
  );
}

/** The drafted PR text, when it was written for this exact commit. */
export function currentPrDraft(task: TaskRecord, headSha: string): TaskRecord['pr_draft'] {
  return task.pr_draft && task.pr_draft.head_sha === headSha ? task.pr_draft : undefined;
}

const PROMPT_PREVIEW_CHARS = 1200;

export function prTitle(task: TaskRecord, headSha: string): string {
  const draft = currentPrDraft(task, headSha);
  if (draft) return draft.title.trim().split('\n')[0]!.slice(0, 120);
  return taskTitle(task);
}

/** A one-line title from the task prompt, for commits and when no PR draft exists. */
export function taskTitle(task: TaskRecord): string {
  const firstLine = (task.prompt.trim().split('\n')[0] ?? task.id).replace(/[\s:;,.-]+$/, '');
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine || task.id;
}

/**
 * The PR description: the drafted body when there is one for this commit, otherwise a short
 * summary of the task. Either way, the factory's record goes in a collapsed footer.
 */
export function prBody(task: TaskRecord, headSha: string): string {
  const draft = currentPrDraft(task, headSha);
  const lines: string[] = [];
  if (draft) lines.push(draft.body.trim(), '');
  else {
    const prompt = task.prompt.trim();
    lines.push(
      '## Task',
      '',
      prompt.length > PROMPT_PREVIEW_CHARS
        ? `${prompt.slice(0, PROMPT_PREVIEW_CHARS)}\n\n… (truncated)`
        : prompt,
      '',
    );
    if (task.review) lines.push('## Summary', '', task.review.summary, '');
  }
  lines.push('---', '', '<details>', '<summary>Factory record</summary>', '');
  lines.push(
    `- Task: \`${task.id}\`${task.verdict ? ` (${task.verdict.kind}, size ${task.verdict.loe})` : ''}`,
  );
  if (task.verification)
    lines.push(
      `- Verification: ${task.verification.passed ? 'passed' : 'failed'} at \`${task.verification.head_sha.slice(0, 12)}\`` +
        (task.verification.not_run_locally?.length
          ? `; not run locally (too broad for the workstation): ${task.verification.not_run_locally.join(', ')}. CI must pass before merge.`
          : ''),
    );
  if (task.review) {
    lines.push(`- Automated review: ${task.review.verdict}, ${task.review.findings.length} finding(s)`);
    for (const f of task.review.findings)
      lines.push(`  - **${f.severity}**${f.file ? ` \`${f.file}\`` : ''}: ${oneLine(f.message)}`);
  }
  if (task.approval?.note) lines.push(`- Approval note: ${oneLine(task.approval.note)}`);
  lines.push('', receiptMarkdown(receiptClaims(task, headSha)));
  lines.push('', '</details>', '', 'Opened by factory-elections after human approval.');
  return lines.join('\n');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Dollars spent on a task so far. Unknown costs count as zero here; they stay null in the record. */
export function taskSpend(task: TaskRecord): number {
  return (task.attempts ?? []).reduce((sum, a) => sum + (a.cost_usd ?? 0), 0);
}

/**
 * Reads a model error message as a failure kind. Rate limits and overload are short and worth a
 * retry; a usage limit lasts until the plan resets, so the step stops and the task stays resumable.
 */
export function modelFailureKind(message: string): ModelFailure {
  const m = message.toLowerCase();
  if (/usage limit|hit your limit|limit will reset|credit balance/.test(m)) return 'usage-limit';
  if (/\b429\b|rate.?limit|overloaded|\b529\b|too many requests/.test(m)) return 'rate-limited';
  if (/max.?budget|budget exceeded|error_max_budget/.test(m)) return 'budget';
  return 'error';
}
