// Check output that shows the machine, not the change, is at fault. A stronger model cannot fix
// an expired login or a stopped database, so such a failure stops the coder ladder.

export interface EnvironmentFailure {
  /** Plain words for the task page, e.g. "a network service is not reachable". */
  reason: string;
  /** The output line that matched. */
  line: string;
}

const KNOWN: [RegExp, string][] = [
  [/\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET)\b|tunnel error/, 'a network service is not reachable'],
  [
    /Token has expired|ExpiredToken|Unable to locate credentials|SSO session is expired|credentials have expired/i,
    'a credential has expired or is missing',
  ],
  [/Cannot connect to the Docker daemon|docker daemon is not running/i, 'Docker is not running'],
  [/\bENOSPC\b|no space left on device/i, 'the disk is full'],
  [/too broad to run on this machine/, 'the check command refused this change as too broad for this machine'],
];

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
