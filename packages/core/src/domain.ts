// Pure task rules: readiness, gates and record updates. No I/O; time is passed in.
import type { ClassifierVerdict, ReadinessDecision, RepoProfile, Stage, TaskRecord } from './schemas.ts';

export function readinessDecision(verdict: ClassifierVerdict): ReadinessDecision {
  if (verdict.kind === 'unsupported') return { action: 'unsupported' };
  switch (verdict.readiness) {
    case 'ready':
      return { action: 'continue' };
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
  if (!task.review) reasons.push('the reviewer has not reviewed the change');
  else if (task.review.head_sha !== headSha) reasons.push('the review is for an older commit');
  if (task.pr) reasons.push('a pull request is already open');
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
export function isGeneratedPath(path: string): boolean {
  const parts = path.split('/');
  const name = parts.at(-1) ?? '';
  return (
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

export function prTitle(task: TaskRecord): string {
  const firstLine = task.prompt.trim().split('\n')[0] ?? task.id;
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

export function prBody(task: TaskRecord): string {
  const lines = ['## Task', '', task.prompt.trim(), ''];
  if (task.verdict)
    lines.push(`Classifier: kind \`${task.verdict.kind}\`, size \`${task.verdict.loe}\`.`, '');
  if (task.verification)
    lines.push(
      '## Verification',
      '',
      `Profile test and full-check commands passed at \`${task.verification.head_sha.slice(0, 12)}\`.`,
      '',
    );
  if (task.review) {
    lines.push('## Automated review', '', task.review.summary, '');
    for (const f of task.review.findings)
      lines.push(`- **${f.severity}**${f.file ? ` \`${f.file}\`` : ''}: ${f.message}`);
    if (task.review.findings.length) lines.push('');
  }
  if (task.approval?.note) lines.push('## Human approval note', '', task.approval.note, '');
  lines.push(`---`, `Opened by factory-elections for task \`${task.id}\` after human approval.`);
  return lines.join('\n');
}
