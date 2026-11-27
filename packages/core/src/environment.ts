// Check output that shows the machine, setup or a protected path, not the code, is at fault. A
// stronger model cannot fix an expired login, a missing tool or a path only a person can allow,
// so such a failure stops the coder ladder. Test and type failures still climb it.

export interface EnvironmentFailure {
  /** Plain words for the task page, e.g. "a network service is not reachable". */
  reason: string;
  /** The output line that matched. */
  line: string;
}

const TOO_BROAD = /too broad to run on this machine/;

const KNOWN: [RegExp, string][] = [
  [/\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET)\b|tunnel error/, 'a network service is not reachable'],
  [
    /Token has expired|ExpiredToken|Unable to locate credentials|SSO session is expired|credentials have expired/i,
    'a credential has expired or is missing',
  ],
  [/Cannot connect to the Docker daemon|docker daemon is not running/i, 'Docker is not running'],
  [/\bENOSPC\b|no space left on device/i, 'the disk is full'],
  [
    /command not found|ERR_PNPM_(UNSUPPORTED_ENGINE|OUTDATED_LOCKFILE|NO_MATCHING_VERSION)/,
    'setup is incomplete (a tool or dependency is missing)',
  ],
  [/the change touches protected paths/, 'the change touches protected paths, which a person must allow'],
  [TOO_BROAD, 'the check command refused this change as too broad for this machine'],
];

/**
 * The output line where a check refused the change as too broad to run on this machine (a
 * catalog or root lockfile change touches every workspace). Verification does not fail for it:
 * the check is left to CI, and the task says so.
 */
export function tooBroadForLocalCheck(output: string): string | undefined {
  return output
    .split('\n')
    .find((line) => TOO_BROAD.test(line))
    ?.trim();
}

/** Lockfiles whose contents decide when setup must run again, when the profile names none. */
export const DEFAULT_SETUP_INPUTS = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
] as const;

/**
 * The first output line that shows an environment fault, from the known faults and then the
 * profile's own patterns (regular expression sources).
 */
export function environmentFailure(
  output: string,
  patterns: readonly string[] = [],
): EnvironmentFailure | undefined {
  const lines = output.split('\n');
  const rules: [RegExp, string][] = [
    ...KNOWN,
    ...patterns.map((source): [RegExp, string] => [
      new RegExp(source),
      `the output matches the profile pattern /${source}/`,
    ]),
  ];
  for (const [pattern, reason] of rules) {
    const line = lines.find((text) => pattern.test(text));
    if (line !== undefined) return { reason, line: line.trim() };
  }
  return undefined;
}
