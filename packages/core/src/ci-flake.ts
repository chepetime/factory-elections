// Flake triage for a failed CI check. Pure and deterministic: GitHub facts and the failed log go in,
// a verdict comes out, never a model. Evidence is read in this order and the first hit wins:
//   1. the same head SHA already passed this check,
//   2. the project lists the check as flaky (`tending.flaky_checks`),
//   3. the log shows an assertion or compile failure: a real failure,
//   4. the log shows an infrastructure failure (timeout, reset connection, lost runner, exit 143),
//   5. the failure is on a commit that only merged the base into a green head.
// Anything else is `unknown`, and `unknown` never counts as a flake.

export type FlakeVerdict = 'flake' | 'real' | 'unknown';
export type FlakeEvidence =
  'same-sha-pass' | 'known-flaky' | 'assertion' | 'infra' | 'base-merge-on-green' | 'none';

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

export function classifyFlake(
  check: { name: string },
  history: FlakeHistory,
  log: string | undefined,
): FlakeResult {
  if (history.passed_on_head.includes(check.name)) return { verdict: 'flake', evidence: 'same-sha-pass' };
  if (history.flaky_checks.includes(check.name)) return { verdict: 'flake', evidence: 'known-flaky' };
  if (log && ASSERTION.test(log)) return { verdict: 'real', evidence: 'assertion' };
  if (log && INFRA.test(log)) return { verdict: 'flake', evidence: 'infra' };
  if (history.base_merge_on_green) return { verdict: 'flake', evidence: 'base-merge-on-green' };
  return { verdict: 'unknown', evidence: 'none' };
}
