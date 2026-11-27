// Approval carry: a person approves one exact commit before the first push. A later agent push (PR
// tending, a review-loop fix) goes out under that approval only when code can show the new head is
// the approved patch, or the approved patch plus a change the reviewers asked for. No model decides
// this and no line count is used: every file's patch gets a fingerprint (its `+`, `-` and context
// lines, without line numbers), and the new head is compared with the approved head file by file.
//
// A clean base merge leaves every fingerprint equal, so it carries. Everything else that changes a
// file waits for a new approval at the usual gate.
import { isForbiddenPath } from './domain.ts';

/** One file's patch fingerprint, by repository-relative path. */
export type FileFingerprints = Readonly<Record<string, string>>;

/**
 * What made the new commit. Only `answer-threads` may add changes under a carry: its reviewers are
 * people. A review-loop fix comes from a model's findings, so it carries only when nothing moved.
 */
export type CarryTrigger = 'merge-base' | 'fix-ci' | 'answer-threads' | 'review';

export interface CarryDecision {
  carried: boolean;
  /** `identical`: every fingerprint is equal. `comments`: only the files the reviewers asked about moved. */
  rule: 'identical' | 'comments' | 'protected-path' | 'uncommented-files' | 'not-allowed' | 'no-approval';
  reason: string;
  /** Files whose patch differs between the approved head and the new head. */
  moved: string[];
}

/** Paths that never carry: CI and tooling config, dependency manifests, lockfiles and secrets. */
export const DEFAULT_PROTECTED_PATHS: readonly string[] = [
  '.github/',
  '.claude/',
  '.husky/',
  '.env',
  '.npmrc',
  '.nvmrc',
];

/** Base names that are protected in any directory. */
const PROTECTED_BASENAMES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Dockerfile',
  'docker-compose.yml',
  'Makefile',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'pyproject.toml',
  'poetry.lock',
  'requirements.txt',
  'Gemfile',
  'Gemfile.lock',
  'action.yml',
  'action.yaml',
]);

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dir = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Whether a path may never ride on an earlier approval: the defaults plus the profile's own list. */
export function isProtectedPath(path: string, extra: readonly string[] = []): boolean {
  const name = base(path);
  return (
    isForbiddenPath(path, [...DEFAULT_PROTECTED_PATHS, ...extra]) ||
    PROTECTED_BASENAMES.has(name) ||
    name.startsWith('.env.') ||
    name.startsWith('Dockerfile.') ||
    name.endsWith('.lock')
  );
}

const TEST_NAME = /\.(test|spec)\.[^./]+$/;
const TEST_DIR = /(^|\/)(tests?|__tests__)\//;
const DOC_NAME = /\.(md|mdx|rst)$/i;

/** A test or a doc by its name or place. */
export function isTestOrDoc(path: string): boolean {
  return TEST_NAME.test(path) || TEST_DIR.test(path) || DOC_NAME.test(path) || path.startsWith('docs/');
}

const stem = (path: string) =>
  base(path)
    .replace(TEST_NAME, '')
    .replace(/\.[^./]+$/, '');
/** `packages/x/…` belongs to the package `packages/x`; any other path to the repository itself. */
const root = (path: string) => (path.startsWith('packages/') ? path.split('/').slice(0, 2).join('/') : '');

/** A test or doc beside a file the reviewers commented on: the same folder, or its test by name. */
export function isSiblingTestOrDoc(path: string, commented: string): boolean {
  if (!isTestOrDoc(path)) return false;
  if (dir(path) === dir(commented)) return true;
  return root(path) === root(commented) && stem(path) === stem(commented);
}

/**
 * Splits a unified diff (`git diff --no-color --no-renames`) into one fingerprint per file. A
 * fingerprint is `hash` of the file's `+`, `-` and context lines: hunk headers (line numbers) and
 * file headers are left out, so the same change at another place in the file, or on a newer base,
 * has the same fingerprint.
 */
export function patchFingerprints(diff: string, hash: (text: string) => string): FileFingerprints {
  const files = new Map<string, string[]>();
  let current: string[] | undefined;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      current = files.get(header[2]!) ?? [];
      files.set(header[2]!, current);
      inHunk = false;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    // Before the first hunk: `index`, mode, `---` and `+++` lines, or a binary marker.
    if (!inHunk) {
      if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) current.push(line);
      continue;
    }
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line.startsWith('\\'))
      current.push(line);
  }
  const out: Record<string, string> = {};
  for (const [path, lines] of files) out[path] = hash(lines.join('\n'));
  return out;
}

/** The files of the review threads that trusted reviewers wrote, for the `comments` input. */
export function commentedFiles(
  threads: readonly { path?: string; comments: readonly { author: string }[] }[],
  trustedAuthors: readonly string[] | undefined,
): string[] {
  const trusted = new Set((trustedAuthors ?? []).map((a) => a.toLowerCase()));
  const files = new Set<string>();
  for (const thread of threads) {
    const first = thread.comments[0]?.author.toLowerCase();
    if (thread.path && first && trusted.has(first)) files.add(thread.path);
  }
  return [...files];
}

/**
 * Whether a new head may be pushed under the approval of an earlier head. `approved` and `candidate`
 * are per-file fingerprints of each head against its own merge base with the PR's base branch;
 * `comments` are the files trusted reviewers commented on; `protectedPaths` come from the profile
 * and add to the defaults.
 *
 * - every fingerprint equal (a clean base merge): carries;
 * - `answer-threads`: carries when each moved file is a commented file or a test or doc
 *   beside one, and no protected path moved;
 * - anything else (`fix-ci`, `review`, a merge resolution that changed the patch): waits for a new approval.
 */
export function carryApproval(
  approved: FileFingerprints | undefined,
  candidate: FileFingerprints,
  comments: readonly string[],
  protectedPaths: readonly string[],
  trigger: CarryTrigger,
): CarryDecision {
  if (!approved)
    return { carried: false, rule: 'no-approval', reason: 'there is no approved head to carry', moved: [] };
  const moved = [...new Set([...Object.keys(approved), ...Object.keys(candidate)])]
    .filter((path) => approved[path] !== candidate[path])
    .sort();
  if (!moved.length)
    return {
      carried: true,
      rule: 'identical',
      reason: 'every file patch equals the approved patch (a clean base merge changes none)',
      moved,
    };
  const protectedMoved = moved.filter((path) => isProtectedPath(path, protectedPaths));
  if (protectedMoved.length)
    return {
      carried: false,
      rule: 'protected-path',
      reason: `protected paths moved: ${protectedMoved.join(', ')}`,
      moved,
    };
  if (trigger !== 'answer-threads')
    return {
      carried: false,
      rule: 'not-allowed',
      reason: `a ${trigger} change to ${moved.join(', ')} needs a new approval`,
      moved,
    };
  const extra = moved.filter(
    (path) => !comments.includes(path) && !comments.some((c) => isSiblingTestOrDoc(path, c)),
  );
  if (extra.length)
    return {
      carried: false,
      rule: 'uncommented-files',
      reason: `files the reviewers did not comment on moved: ${extra.join(', ')}`,
      moved,
    };
  return {
    carried: true,
    rule: 'comments',
    reason: `only commented files, and tests or docs beside them, moved: ${moved.join(', ')}`,
    moved,
  };
}
