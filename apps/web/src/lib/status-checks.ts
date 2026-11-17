// Shared shape of the settings page's system checks, plus the pure parser for `factory doctor`.

export type CheckStatus = 'ok' | 'warn' | 'fail';
export type CheckGroup = 'Environment' | 'Engine' | 'Projects';

export interface StatusCheck {
  id: string;
  group: CheckGroup;
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface StatusReport {
  checkedAt: string;
  checks: StatusCheck[];
}

/** Parses `ok    Name: detail` / `FAIL  Name: detail` lines, each optionally followed by `fix: …`. */
export function parseDoctor(stdout: string): StatusCheck[] {
  const checks: StatusCheck[] = [];
  for (const raw of stdout.split('\n')) {
    const fix = /^\s+fix:\s*(.+)$/.exec(raw);
    if (fix && checks.length > 0) {
      checks[checks.length - 1]!.fix = fix[1]!.trim();
      continue;
    }
    const line = /^(ok|FAIL)\s+([^:]+):\s*(.*)$/.exec(raw);
    if (!line) continue;
    const name = line[2]!.trim();
    checks.push({
      id: `env-${name.toLowerCase().replace(/\W+/g, '-')}`,
      group: 'Environment',
      name,
      status: line[1] === 'ok' ? 'ok' : 'fail',
      detail: line[3]!.trim(),
    });
  }
  return checks;
}

export function summarize(checks: StatusCheck[]): { status: CheckStatus; failing: number; warning: number } {
  const failing = checks.filter((c) => c.status === 'fail').length;
  const warning = checks.filter((c) => c.status === 'warn').length;
  return { status: failing ? 'fail' : warning ? 'warn' : 'ok', failing, warning };
}
