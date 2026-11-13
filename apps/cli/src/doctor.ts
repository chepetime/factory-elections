// Checks the local prerequisites for the task-to-PR workflow and says how to fix each one.
import { run } from '@factory/adapters-process';
import { isReadableDirectory } from '@factory/adapters-fs';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export async function doctor(root: string): Promise<boolean> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'Node.js >= 26',
    ok: major >= 26,
    detail: process.version,
    fix: 'Install Node 26, e.g. `mise use -g node@26` or `brew install node`.',
  });

  const gitVersion = await run('git', ['--version']);
  checks.push({
    name: 'git',
    ok: gitVersion.code === 0,
    detail: gitVersion.stdout.trim() || 'not found',
    fix: 'Install git: `xcode-select --install`.',
  });

  const gh = await run('gh', ['auth', 'status']);
  checks.push({
    name: 'GitHub CLI signed in',
    ok: gh.code === 0,
    detail: gh.code === 127 ? 'gh not found' : gh.code === 0 ? 'signed in' : 'not signed in',
    fix: gh.code === 127 ? 'Install with `brew install gh`, then `gh auth login`.' : 'Run `gh auth login`.',
  });

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const claude = await run('claude', ['auth', 'status']);
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

  const store = await isReadableDirectory(root);
  checks.push({
    name: 'Data root',
    ok: store !== 'unavailable',
    detail: `${root} (${store})`,
    fix: 'Make the data root a readable directory or set FACTORY_ROOT.',
  });

  for (const c of checks)
    process.stdout.write(
      `${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}: ${c.detail}${c.ok || !c.fix ? '' : `\n      fix: ${c.fix}`}\n`,
    );
  return checks.every((c) => c.ok);
}
