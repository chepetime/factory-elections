// Checks the local prerequisites for the task-to-PR workflow and says how to fix each one.
import { run } from '@factory/adapters-process';
import { isReadableDirectory } from '@factory/adapters-fs';
import { parseVersion, TESTED_RUNTIMES } from '@factory/core';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

type Runner = (command: string, args: readonly string[]) => Promise<{ code: number | null; stdout: string }>;

const diagnosticRun: Runner = (command, args) =>
  run(command, args, { timeoutMs: 10_000, captureLimit: 16_000 });

export async function pnpmCheck(runner: Runner = diagnosticRun): Promise<Check> {
  const pnpm = await runner('pnpm', ['--version']);
  const ok = pnpm.code === 0;
  return {
    name: 'pnpm',
    ok,
    detail: ok ? pnpm.stdout.trim() : 'not found',
    fix: 'Install pnpm: `brew install pnpm` (or `corepack enable`).',
  };
}

/**
 * The provider CLI versions on PATH beside the tested ones. These checks inform and never fail: a
 * different version may work, but its lifecycle behavior (cancel, resume, stream framing) is not
 * verified. Model access is checked apart, by "Claude model access".
 */
export async function runtimeVersionChecks(runner: Runner = diagnosticRun): Promise<Check[]> {
  const [claude, codex] = await Promise.all([
    runner('claude', ['--version']),
    runner('codex', ['--version']),
  ]);
  const describe = (out: { code: number | null; stdout: string }, tested: string, missing: string) => {
    const found = out.code === 0 ? parseVersion(out.stdout) : undefined;
    const detail = !found
      ? out.code === 0
        ? `version not recognized; tested with ${tested}`
        : missing
      : found === tested
        ? `${found} (tested)`
        : `${found}; tested with ${tested}, so cancel, resume and stream behavior are not verified`;
    return { ok: true, detail };
  };
  return [
    {
      name: 'Claude CLI version (review turns)',
      ...describe(claude, TESTED_RUNTIMES.claudeCli, 'claude not found; PR review turns need it'),
    },
    {
      name: 'Claude Agent SDK (tasks)',
      ok: true,
      detail: `${TESTED_RUNTIMES.claudeAgentSdk} with bundled Claude Code ${TESTED_RUNTIMES.claudeSdkCli} (lockfile)`,
    },
    {
      name: 'Codex CLI version',
      ...describe(codex, TESTED_RUNTIMES.codexCli, 'codex not installed (optional)'),
    },
  ];
}

export async function environmentChecks(root: string): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'Node.js >= 26',
    ok: major >= 26,
    detail: process.version,
    fix: 'Install Node 26, e.g. `mise use -g node@26` or `brew install node`.',
  });

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const [gitVersion, pnpm, gh, claude, store, runtimes] = await Promise.all([
    diagnosticRun('git', ['--version']),
    pnpmCheck(),
    diagnosticRun('gh', ['auth', 'status']),
    hasKey ? Promise.resolve({ code: 0, stdout: '' }) : diagnosticRun('claude', ['auth', 'status']),
    isReadableDirectory(root),
    runtimeVersionChecks(),
  ]);
  checks.push({
    name: 'git',
    ok: gitVersion.code === 0,
    detail: gitVersion.stdout.trim() || 'not found',
    fix: 'Install git: `xcode-select --install`.',
  });

  checks.push(pnpm);

  checks.push({
    name: 'GitHub CLI signed in',
    ok: gh.code === 0,
    detail: gh.code === 127 ? 'gh not found' : gh.code === 0 ? 'signed in' : 'not signed in',
    fix: gh.code === 127 ? 'Install with `brew install gh`, then `gh auth login`.' : 'Run `gh auth login`.',
  });

  const claudeOk = hasKey || claude.code === 0;
  checks.push({
    name: 'Claude model access',
    ok: claudeOk,
    detail: hasKey
      ? 'ANTHROPIC_API_KEY is set'
      : claude.code === 0
        ? 'Claude Code is signed in'
        : claude.code === 127
          ? 'claude CLI not found and no ANTHROPIC_API_KEY'
          : 'Claude Code is not signed in',
    fix: 'Run `claude` once and sign in (or `claude auth login`), or export ANTHROPIC_API_KEY.',
  });

  checks.push(...runtimes);

  checks.push({
    name: 'Data root',
    ok: store !== 'unavailable',
    detail: `${root} (${store})`,
    fix: 'Make the data root a readable directory or set FACTORY_ROOT.',
  });

  return checks;
}
