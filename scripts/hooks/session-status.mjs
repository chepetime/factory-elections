#!/usr/bin/env node
// Claude Code SessionStart hook: one short block about the factory stack, so a session starts with
// what it would otherwise check by hand (is it running, which commit, from where, what is busy).
// Read-only and bounded: every probe has a short timeout, and a down stack is a normal answer.
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const lines = [];
const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { cwd: repo, encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    return '';
  }
};
const head = sh('git', ['log', '--oneline', '-1']);
const branch = sh('git', ['branch', '--show-current']);
lines.push(`Checkout: ${repo} on ${branch || 'detached'} at ${head}`);
const get = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok ? await r.json() : undefined;
  } catch {
    return undefined;
  }
};
const health = await get('http://127.0.0.1:4318/health');
if (!health)
  lines.push(
    'Factory stack: not running (health :4318 does not answer). Start: pnpm start -- --dev, from a terminal.',
  );
else {
  const web = sh('ps', ['-axo', 'pid=,command='])
    .split('\n')
    .find((l) => /scripts\/web\.mjs/.test(l) && !/sh -c/.test(l));
  lines.push(
    `Factory stack: running (engine ${health.engine}, recovery ${health.recovery?.state ?? 'n/a'})` +
      (health.host_session ? ', started from a Claude Code session (agent turns may be capped)' : '') +
      (web ? `, web.mjs pid ${web.trim().split(/\s+/)[0]}` : ''),
  );
  const projects = (await get('http://localhost:3000/api/projects')) ?? [];
  const busy = [];
  for (const p of projects) {
    const issues = (await get(`http://localhost:3000/api/projects/${p.name}/issues`)) ?? [];
    for (const i of issues) if (i.run?.owned || i.run?.waiting) busy.push(`${p.name}/${i.key}`);
  }
  lines.push(busy.length ? `Busy runs: ${busy.join(', ')} (do not restart over them)` : 'Busy runs: none');
}
lines.push(
  `Tools: pnpm restart [--dry-run] · pnpm shot <path> · pnpm factory paths|issue show|review diagnose|spans · see docs/harnes/RECIPES.md`,
);
process.stdout.write(`${lines.join('\n')}\n`);
