// PR tending: keep an open factory PR moving until a human merges it. Pure: the PR's state and the
// tending record go in, the next action comes out. The backend reads GitHub and acts.
//
// Order: a merged or closed PR ends tending; then conflicts (merge the base in), then review
// threads waiting on the author, then failed checks (rerun once per commit, then fix). Never a
// force-push, never a merge of the PR itself. After MAX_TEND_FIXES agent fixes without a green PR
// tending stops and the PR goes to the inbox.
import { z } from 'zod';
import type { FlakeVerdict } from './ci-flake.ts';

export const MAX_TEND_FIXES = 3;
export const TEND_EVERY_MS = 10 * 60_000;

export const PrCheck = z.object({
  name: z.string(),
  state: z.enum(['pass', 'fail', 'pending', 'skipped']),
  /** The Actions run, for reruns and failed logs. */
  run_id: z.string().optional(),
  link: z.string().optional(),
});
export type PrCheck = z.infer<typeof PrCheck>;

export const PrThread = z.object({
  id: z.string(),
  resolved: z.boolean(),
  outdated: z.boolean().default(false),
  path: z.string().optional(),
  line: z.number().nullable().optional(),
  comments: z.array(z.object({ id: z.string(), author: z.string(), body: z.string() })),
});
export type PrThread = z.infer<typeof PrThread>;

export const PrState = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
  head_sha: z.string(),
  base: z.string(),
  mergeable: z.enum(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']),
  checks: z.array(PrCheck),
  threads: z.array(PrThread),
});
export type PrState = z.infer<typeof PrState>;

/** The few PR facts the board needs on every pass: open, merged or closed, and draft or not. */
export const PrStatus = z.object({
  number: z.number().int().positive(),
  state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
  draft: z.boolean(),
});
export type PrStatus = z.infer<typeof PrStatus>;

export const TendFix = z.object({
  kind: z.enum(['merge-base', 'fix-ci', 'answer-threads', 'rerun']),
  at: z.string(),
  /** The head before the fix. */
  sha: z.string(),
  outcome: z.enum(['pushed', 'no-change', 'failed', 'rerun']),
  cost_usd: z.number().nullable().optional(),
  note: z.string().optional(),
  /** The head after a pushed fix. */
  head: z.string().optional(),
  /** A merge-base fix: every check was green before the base came in. */
  was_green: z.boolean().optional(),
});
export type TendFix = z.infer<typeof TendFix>;

/** A rerun of one check on one head, with the verdict that allowed it. `check` is `*` for a legacy SHA entry. */
export const CiRetry = z.object({
  sha: z.string(),
  check: z.string(),
  verdict: z.enum(['flake', 'unknown']),
});
export type CiRetry = z.infer<typeof CiRetry>;
export const MAX_CI_RETRIES = 100;

/** Old records kept `reruns: string[]` (head SHAs): each becomes a retry of every check on that head. */
const migrateRecord = (raw: unknown) => {
  if (typeof raw !== 'object' || raw === null || !('reruns' in raw)) return raw;
  const { reruns, ...rest } = raw as Record<string, unknown>;
  const legacy = Array.isArray(reruns)
    ? reruns
        .filter((s): s is string => typeof s === 'string')
        .map((sha) => ({ sha, check: '*', verdict: 'unknown' }))
    : [];
  const current = Array.isArray(rest.ci_retries) ? rest.ci_retries : [];
  return { ...rest, ci_retries: [...legacy, ...current] };
};

export const TendRecord = z.preprocess(
  migrateRecord,
  z.object({
    number: z.number().int().positive(),
    url: z.string(),
    checked_at: z.string().optional(),
    /** Reruns done, per head SHA and check. Capped: the newest MAX_CI_RETRIES stay. */
    ci_retries: z
      .array(CiRetry)
      .default([])
      .transform((r) => r.slice(-MAX_CI_RETRIES)),
    /** Thread comments answered already: `<thread id>:<last comment id>`. */
    answered: z.array(z.string()).default([]),
    /** IDs of the reply comments tending posted itself: they never start another answer. */
    replies: z.array(z.string()).default([]),
    fixes: z.array(TendFix).default([]),
    /** Agent fixes since the PR was last green. */
    fixes_since_green: z.number().int().nonnegative().default(0),
    last: z.string().optional(),
    /** Hash of the lockfiles that tending last installed; a change runs setup again. */
    setup_key: z.string().optional(),
    stopped: z.object({ reason: z.string(), at: z.string() }).optional(),
    ended: z.object({ state: z.enum(['MERGED', 'CLOSED']), at: z.string() }).optional(),
  }),
);
export type TendRecord = z.infer<typeof TendRecord>;

export type TendAction =
  | { kind: 'end'; state: 'MERGED' | 'CLOSED' }
  | { kind: 'stop'; reason: string }
  | { kind: 'merge-base' }
  | { kind: 'answer-threads'; threads: PrThread[] }
  | { kind: 'rerun'; checks: PrCheck[] }
  | { kind: 'fix-ci'; checks: PrCheck[] }
  | { kind: 'wait'; reason: string };

const threadKey = (t: PrThread) => `${t.id}:${t.comments.at(-1)?.id ?? ''}`;

/**
 * Threads with a comment not answered yet. The thread's comments are already only the trusted ones
 * (see `trustedThreads` in the backend), without tending's own replies: the last one is the newest
 * trusted comment, and a thread waits only while that comment is newer than the last answer.
 */
export function threadsWaiting(pr: PrState, record: TendRecord): PrThread[] {
  return pr.threads.filter(
    (t) => !t.resolved && !t.outdated && t.comments.length > 0 && !record.answered.includes(threadKey(t)),
  );
}
export const answeredKey = threadKey;

/** Permission levels that may steer an agent that pushes. `permission` reports `maintain` as `write`. */
const TRUSTED_ROLES = new Set(['admin', 'maintain', 'write']);

/** True when a collaborator's permission lookup shows write access. Anything else is not trusted. */
export function hasWriteAccess(access: { permission?: string | null; role_name?: string | null }): boolean {
  return [access.permission, access.role_name].some((p) => TRUSTED_ROLES.has((p ?? '').toLowerCase()));
}

/** GitHub logins: letters, digits and hyphens, with `[bot]` for apps. Checked before a login is put in a path. */
export const isGitHubLogin = (login: string) =>
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$/.test(login);

/** A check's newest settled result on the base branch tip. */
export type BaseCheckState = 'pass' | 'fail' | 'pending';
export type BaseVerdict = 'own' | 'fixed_on_base' | 'base_pending' | 'inherited';

/**
 * Where a failed PR check stands against the same check on the base: `inherited` (base fails too),
 * `base_pending` (base is still running), `fixed_on_base` (base passes and has not been merged into
 * the PR yet), else `own`. After a base merge, what still fails is the PR's own.
 */
export function baseVerdict(base: BaseCheckState | undefined, baseMerged: boolean): BaseVerdict {
  if (base === 'fail') return 'inherited';
  if (base === 'pending') return 'base_pending';
  if (base === 'pass' && !baseMerged) return 'fixed_on_base';
  return 'own';
}

export const waitingOnBase = (names: readonly string[]) => `Waiting for ${names.join(', ')} to pass on main`;

export function nextTendAction(
  pr: PrState,
  record: TendRecord,
  options: {
    answerThreads: boolean;
    verdicts?: Readonly<Record<string, FlakeVerdict>>;
    /** The same checks on the base branch tip, by name. A check missing here has no base result. */
    base?: Readonly<Record<string, BaseCheckState>>;
  },
): TendAction {
  if (pr.state !== 'OPEN') return { kind: 'end', state: pr.state };
  if (record.stopped) return { kind: 'wait', reason: `stopped: ${record.stopped.reason}` };
  const agentWork = (action: TendAction): TendAction =>
    record.fixes_since_green >= MAX_TEND_FIXES
      ? { kind: 'stop', reason: `${MAX_TEND_FIXES} fixes did not make the PR green` }
      : action;
  if (pr.mergeable === 'CONFLICTING') return agentWork({ kind: 'merge-base' });
  const threads = options.answerThreads ? threadsWaiting(pr, record) : [];
  if (threads.length) return agentWork({ kind: 'answer-threads', threads });
  const allFailed = pr.checks.filter((c) => c.state === 'fail');
  if (pr.checks.some((c) => c.state === 'pending')) return { kind: 'wait', reason: 'checks are running' };
  const baseMerged = record.fixes.some((f) => f.kind === 'merge-base' && f.outcome === 'pushed');
  const verdictOf = (c: PrCheck) => baseVerdict(options.base?.[c.name], baseMerged);
  // A check that fails on main too is not this PR's to fix; one main has fixed needs main merged first.
  const fixedOnBase = allFailed.filter((c) => verdictOf(c) === 'fixed_on_base');
  if (fixedOnBase.length) return agentWork({ kind: 'merge-base' });
  const failed = allFailed.filter((c) => verdictOf(c) === 'own');
  const held = allFailed.filter((c) => !failed.includes(c));
  if (held.length && !failed.length) return { kind: 'wait', reason: waitingOnBase(held.map((c) => c.name)) };
  if (failed.length) {
    // A check that is not a real failure gets one rerun per commit before an agent spends money on
    // it. A real failure (see `classifyFlake`) goes straight to a fix. A rerun needs a run to rerun.
    const retried = (c: PrCheck) =>
      record.ci_retries.some((r) => r.sha === pr.head_sha && (r.check === c.name || r.check === '*'));
    const rerunnable = failed.filter((c) => c.run_id && options.verdicts?.[c.name] !== 'real' && !retried(c));
    const fixable = failed.filter((c) => !rerunnable.includes(c));
    if (!fixable.length) return { kind: 'rerun', checks: rerunnable };
    return agentWork({ kind: 'fix-ci', checks: fixable });
  }
  if (pr.mergeable === 'UNKNOWN') return { kind: 'wait', reason: 'GitHub is still computing mergeability' };
  return { kind: 'wait', reason: 'green: waiting for review and merge' };
}

/** A PR is green when nothing fails or runs and it merges cleanly. */
export const isGreen = (pr: PrState) =>
  pr.mergeable === 'MERGEABLE' && pr.checks.every((c) => c.state === 'pass' || c.state === 'skipped');

/** Reads `statusCheckRollup` entries of `gh pr view --json` into checks. */
export function rollupChecks(rollup: readonly Record<string, unknown>[]): PrCheck[] {
  return rollup.map((c) => {
    const name = String(c.name ?? c.context ?? 'check');
    const status = String(c.status ?? '').toUpperCase();
    const conclusion = String(c.conclusion ?? c.state ?? '').toUpperCase();
    const link = String(c.detailsUrl ?? c.targetUrl ?? '');
    const run_id = /\/actions\/runs\/(\d+)/.exec(link)?.[1];
    const state: PrCheck['state'] =
      status && status !== 'COMPLETED'
        ? 'pending'
        : ['SUCCESS', 'NEUTRAL'].includes(conclusion)
          ? 'pass'
          : ['SKIPPED'].includes(conclusion)
            ? 'skipped'
            : ['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS'].includes(conclusion)
              ? 'pending'
              : 'fail';
    return { name, state, ...(run_id ? { run_id } : {}), ...(link ? { link } : {}) };
  });
}

export const TendReplies = z.object({
  replies: z.array(
    z.object({
      thread_id: z.string(),
      /** The reply to post: what changed, or why nothing changed. */
      reply: z.string().min(1).max(4000),
      /** True when the agent changed code for this thread: the thread is resolved after the push. */
      changed: z.boolean(),
    }),
  ),
});
export type TendReplies = z.infer<typeof TendReplies>;

export const TEND_REPLIES_SCHEMA = (() => {
  const { $schema: _, ...schema } = z.toJSONSchema(TendReplies, { io: 'input', target: 'draft-7' });
  return schema as Record<string, unknown>;
})();
