// Flake triage for a failed CI check. Pure and deterministic: GitHub facts and the failed log go in,
// a verdict comes out, never a model. Evidence is read in this order and the first hit wins:
//   1. the same head SHA already passed this check,
//   2. the project lists the check as flaky (`tending.flaky_checks`),
//   3. the log shows an assertion or compile failure: a real failure,
//   4. the log shows an infrastructure failure (timeout, reset connection, lost runner, exit 143),
//   5. the failure is on a commit that only merged the base into a green head.
// Anything else is `unknown`, and `unknown` never counts as a flake.

/** `no-fix`: no change to the PR can make the check pass (cancelled run, missing secret, quota, lock). */
export type FlakeVerdict = 'flake' | 'real' | 'unknown' | 'no-fix';
export type FlakeEvidence =
  | 'same-sha-pass'
  | 'known-flaky'
  | 'assertion'
  | 'infra'
  | 'base-merge-on-green'
  | 'none'
  | 'cancelled'
  | 'missing-secret'
  | 'permission'
  | 'quota'
  | 'deploy-lock';

export interface FlakeHistory {
  /** Names of checks that passed on the head SHA that is failing now. */
  passed_on_head: readonly string[];
  /** The project's known-flaky check names. */
  flaky_checks: readonly string[];
  /** True when the head only merges the base into a head whose checks were green. */
  base_merge_on_green: boolean;
}

export interface FlakeResult {
  verdict: FlakeVerdict;
  evidence: FlakeEvidence;
}

const ASSERTION =
  /AssertionError|Assertion failed|\bExpected:?[^\n]*\n?[^\n]*\b(Received|Actual)\b|expect\([^\n]*\)\.(not\.)?to|\bnot ok \d+|error TS\d+|✖ [^\n]*test|FAIL [^\n]*\.(test|spec)\./i;

const INFRA =
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|network is unreachable|runner[^\n]{0,60}(lost|shutdown|shut down)|lost communication with the server|exit code 143|No space left on device|\b50[234]\b[^\n]{0,30}(Bad Gateway|Service Unavailable|Gateway Time-?out)/i;

/** Failures no PR change can fix, read after an assertion failure has ruled out a real one. */
const NO_FIX: readonly [FlakeEvidence, RegExp][] = [
  [
    'cancelled',
    /The run was canceled by|The operation was canceled|##\[error\]The job was canceled|Canceling since a higher priority waiting request/i,
  ],
  [
    'missing-secret',
    /Input required and not supplied: |secret[^\n]{0,40}(is not set|not found|is empty|is missing)|(?:missing|unset)[^\n]{0,20}secret|Context access might be invalid: secrets\./i,
  ],
  [
    'permission',
    /Resource not accessible by integration|Permission to [^\n]+ denied to|HTTP 403[^\n]{0,40}(forbidden|Resource not accessible)|insufficient permissions/i,
  ],
  [
    'quota',
    /rate limit exceeded|quota (exceeded|exhausted)|exceeded (your|the) (monthly|usage) (quota|limit)|spending limit|billing[^\n]{0,30}(failed|issue)/i,
  ],
  [
    'deploy-lock',
    /deployment (is )?locked|deploy lock|environment[^\n]{0,30}(is )?locked|Waiting for deployment approval|required reviewers? (has|have) not approved/i,
  ],
];

export function classifyFlake(
  check: { name: string },
  history: FlakeHistory,
  log: string | undefined,
): FlakeResult {
  if (history.passed_on_head.includes(check.name)) return { verdict: 'flake', evidence: 'same-sha-pass' };
  if (history.flaky_checks.includes(check.name)) return { verdict: 'flake', evidence: 'known-flaky' };
  if (log && ASSERTION.test(log)) return { verdict: 'real', evidence: 'assertion' };
  if (log) {
    for (const [evidence, pattern] of NO_FIX) if (pattern.test(log)) return { verdict: 'no-fix', evidence };
  }
  if (log && INFRA.test(log)) return { verdict: 'flake', evidence: 'infra' };
  if (history.base_merge_on_green) return { verdict: 'flake', evidence: 'base-merge-on-green' };
  return { verdict: 'unknown', evidence: 'none' };
}
