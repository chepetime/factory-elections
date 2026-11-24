// An evidence receipt: what a task's change is proven to do at one commit, and what is not proven.
// Principle 4 (progress requires evidence) as a record. Claims come only from evidence the task
// recorded for that exact commit; anything else is `not-proven`, never assumed. The backend signs
// the receipt, and `factory receipt verify` checks it again.
import { z } from 'zod';
import { blockingFindings } from './domain.ts';
import type { TaskRecord } from './schemas.ts';

export const ClaimStatus = z.enum(['proven', 'not-proven', 'failed']);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const ReceiptClaim = z.object({
  id: z.string().min(1).max(80),
  statement: z.string().min(1).max(500),
  status: ClaimStatus,
  /** Where the status comes from, or why it is not proven. */
  evidence: z.string().max(1000),
});
export type ReceiptClaim = z.infer<typeof ReceiptClaim>;

/** What one model call was given (Phase 4 configuration manifest). No secret values. */
export const CallManifest = z.object({
  step: z.string().max(100).optional(),
  provider: z.string().max(40),
  model: z.string().max(200),
  effort: z.string().max(20),
  tools: z.string().max(20),
  cwd: z.string().max(4096).optional(),
  sandbox_domains: z.array(z.string().max(300)).max(100).optional(),
  mcp: z.boolean(),
  guarded: z.boolean(),
  resume: z.boolean(),
  budget_usd: z.number().optional(),
  timeout_ms: z.number().optional(),
  stall_ms: z.number().optional(),
  /** Names only; values never leave the process. */
  env_names: z.array(z.string().max(200)).max(200),
  /** SHA-256 of the system prompt, so a reader can tell two instruction sets apart. */
  system_prompt_sha256: z.string().length(64),
  runtime: z.string().max(200),
  calls: z.number().int().positive(),
});
export type CallManifest = z.infer<typeof CallManifest>;

export const ReceiptBody = z.object({
  version: z.literal(1),
  project: z.string(),
  task_id: z.string(),
  head_sha: z.string().min(1),
  issued_at: z.string(),
  claims: z.array(ReceiptClaim),
  manifests: z.array(CallManifest),
});
export type ReceiptBody = z.infer<typeof ReceiptBody>;

export const Receipt = ReceiptBody.extend({
  /** SHA-256 of the canonical JSON of the body. */
  digest: z.string().length(64),
  /** Ed25519 signature of the digest, base64, by this Factory install's receipt key. */
  signature: z.string().min(1),
  /** The public key that checks the signature, PEM (SPKI). */
  public_key: z.string().min(1),
});
export type Receipt = z.infer<typeof Receipt>;

/** JSON with object keys sorted at every level, so the same body always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** Things no local run proves. They stay on every receipt until other evidence exists. */
const NEVER_PROVEN_LOCALLY: ReceiptClaim[] = [
  {
    id: 'ci',
    statement: 'CI on the pull request passes',
    status: 'not-proven',
    evidence: 'Local checks are not CI; read the PR checks.',
  },
  {
    id: 'deployed',
    statement: 'The change works in a deployed environment',
    status: 'not-proven',
    evidence: 'Factory does not deploy.',
  },
];

/** The claims a task's evidence supports at `headSha`. */
export function receiptClaims(task: TaskRecord, headSha: string): ReceiptClaim[] {
  const claims: ReceiptClaim[] = [];
  const v = task.verification;
  const short = headSha.slice(0, 12);
  const atHead = v?.head_sha === headSha;
  claims.push(
    !v
      ? {
          id: 'checks',
          statement: 'The test and full-check commands pass',
          status: 'not-proven',
          evidence: 'No verification ran.',
        }
      : !atHead
        ? {
            id: 'checks',
            statement: 'The test and full-check commands pass',
            status: 'not-proven',
            evidence: `Verification ran on ${v.head_sha.slice(0, 12)}, not on ${short}.`,
          }
        : {
            id: 'checks',
            statement: 'The test and full-check commands pass',
            status: v.passed ? 'proven' : 'failed',
            evidence: `Verification ${v.passed ? 'passed' : 'failed'} on ${short} at ${v.at}.`,
          },
  );
  if (atHead && v?.passed) {
    claims.push({
      id: 'size',
      statement: 'The change has at most 400 non-test lines',
      status: 'proven',
      evidence: 'Verification checks the size before it runs the commands.',
    });
    claims.push(
      v.test_integrity === 'checked'
        ? {
            id: 'tests-intact',
            statement: 'The change deletes, skips and loosens no tests',
            status: 'proven',
            evidence: 'The test-weakening check read the diff and found nothing.',
          }
        : {
            id: 'tests-intact',
            statement: 'The change deletes, skips and loosens no tests',
            status: 'not-proven',
            evidence:
              v.test_integrity === 'allowed'
                ? 'A person allowed test changes for this task, so the check did not run.'
                : 'This verification ran before the test-weakening check existed.',
          },
    );
  }
  for (const check of v && atHead ? (v.not_run_locally ?? []) : [])
    claims.push({
      id: `not-run:${check}`.slice(0, 80),
      statement: `The ${check} check passes`,
      status: 'not-proven',
      evidence: 'It refused the change as too broad for this machine; CI must run it.',
    });
  if (v?.runtime && atHead)
    claims.push({
      id: 'runtime',
      statement: 'The running app shows the change working',
      status: v.runtime === 'yes' ? 'proven' : v.runtime === 'no' ? 'failed' : 'not-proven',
      evidence: `The runtime check said "${v.runtime}".`,
    });
  const r = task.review;
  claims.push(
    !r || r.head_sha !== headSha
      ? {
          id: 'review',
          statement: 'The automated review found no blocking issue',
          status: 'not-proven',
          evidence: r ? `The review is for ${r.head_sha.slice(0, 12)}.` : 'No automated review ran.',
        }
      : blockingFindings(task) === 0
        ? {
            id: 'review',
            statement: 'The automated review found no blocking issue',
            status: 'proven',
            evidence: `${r.verdict}, ${r.findings.length} finding(s), none blocking.`,
          }
        : {
            id: 'review',
            statement: 'The automated review found no blocking issue',
            status: 'failed',
            evidence: `${blockingFindings(task)} blocking finding(s).`,
          },
  );
  const a = task.approval;
  claims.push(
    a?.decision === 'approved' && a.head_sha === headSha
      ? {
          id: 'approved',
          statement: 'A person approved this exact commit',
          status: 'proven',
          evidence: `Approved at ${a.at}.`,
        }
      : {
          id: 'approved',
          statement: 'A person approved this exact commit',
          status: 'not-proven',
          evidence: a ? `The ${a.decision} decision is for ${a.head_sha.slice(0, 12)}.` : 'No approval yet.',
        },
  );
  return [...claims, ...NEVER_PROVEN_LOCALLY];
}

/** The receipt as Markdown for a PR description: proven first, then what is not proven. */
export function receiptMarkdown(claims: readonly ReceiptClaim[], digest?: string): string {
  const mark: Record<ClaimStatus, string> = {
    proven: 'PROVEN',
    'not-proven': 'NOT PROVEN',
    failed: 'FAILED',
  };
  const order: ClaimStatus[] = ['failed', 'proven', 'not-proven'];
  const lines = ['### Evidence receipt', ''];
  for (const status of order)
    for (const c of claims.filter((x) => x.status === status))
      lines.push(`- **${mark[status]}** ${c.statement}. ${c.evidence}`);
  if (digest) lines.push('', `Receipt digest: \`${digest}\` (\`factory receipt verify\`).`);
  return lines.join('\n');
}
