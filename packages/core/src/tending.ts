// PR tending: keep an open factory PR moving until a human merges it. Pure: the PR's state and the
// tending record go in, the next action comes out. The backend reads GitHub and acts.
//
// Order: a merged or closed PR ends tending; then conflicts (merge the base in), then review
// threads waiting on the author, then failed checks (rerun once per commit, then fix). Never a
// force-push, never a merge of the PR itself. After MAX_TEND_FIXES agent fixes without a green PR
// tending stops and the PR goes to the inbox.
import { z } from 'zod';

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

export const TendFix = z.object({
  kind: z.enum(['merge-base', 'fix-ci', 'answer-threads', 'rerun']),
  at: z.string(),
  /** The head before the fix. */
  sha: z.string(),
  outcome: z.enum(['pushed', 'no-change', 'failed', 'rerun']),
  cost_usd: z.number().nullable().optional(),
  note: z.string().optional(),
});
export type TendFix = z.infer<typeof TendFix>;

export const TendRecord = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  checked_at: z.string().optional(),
  /** The head SHAs whose failed checks were rerun already. */
  reruns: z.array(z.string()).default([]),
  /** Thread comments answered already: `<thread id>:<last comment id>`. */
  answered: z.array(z.string()).default([]),
  fixes: z.array(TendFix).default([]),
  /** Agent fixes since the PR was last green. */
  fixes_since_green: z.number().int().nonnegative().default(0),
  last: z.string().optional(),
  /** Hash of the lockfiles that tending last installed; a change runs setup again. */
  setup_key: z.string().optional(),
  stopped: z.object({ reason: z.string(), at: z.string() }).optional(),
  ended: z.object({ state: z.enum(['MERGED', 'CLOSED']), at: z.string() }).optional(),
});
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

/** Threads whose last comment is from someone else, not answered yet. */
export function threadsWaiting(pr: PrState, record: TendRecord, me: string): PrThread[] {
  return pr.threads.filter(
    (t) =>
      !t.resolved &&
      !t.outdated &&
      t.comments.length > 0 &&
      t.comments.at(-1)!.author.toLowerCase() !== me.toLowerCase() &&
      !record.answered.includes(threadKey(t)),
  );
}
export const answeredKey = threadKey;

export function nextTendAction(
  pr: PrState,
  record: TendRecord,
  options: { me: string; answerThreads: boolean },
): TendAction {
  if (pr.state !== 'OPEN') return { kind: 'end', state: pr.state };
  if (record.stopped) return { kind: 'wait', reason: `stopped: ${record.stopped.reason}` };
  const agentWork = (action: TendAction): TendAction =>
    record.fixes_since_green >= MAX_TEND_FIXES
      ? { kind: 'stop', reason: `${MAX_TEND_FIXES} fixes did not make the PR green` }
      : action;
  if (pr.mergeable === 'CONFLICTING') return agentWork({ kind: 'merge-base' });
  const threads = options.answerThreads ? threadsWaiting(pr, record, options.me) : [];
  if (threads.length) return agentWork({ kind: 'answer-threads', threads });
  const failed = pr.checks.filter((c) => c.state === 'fail');
  if (pr.checks.some((c) => c.state === 'pending')) return { kind: 'wait', reason: 'checks are running' };
  if (failed.length) {
    // A flaky job gets one rerun per commit before an agent spends money on it.
    if (!record.reruns.includes(pr.head_sha) && failed.some((c) => c.run_id))
      return { kind: 'rerun', checks: failed };
    return agentWork({ kind: 'fix-ci', checks: failed });
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
