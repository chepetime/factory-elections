#!/usr/bin/env node
// Git pre-commit runner (called by scripts/git-hooks/pre-commit). Blocks, and stays fast: Prettier
// and oxlint on the staged files only. The full changed-surface check runs after the commit lands
// on main (scripts/run-post-commit.mjs). Factory's own commits pass --no-verify and skip this.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });

const top = git('rev-parse', '--show-toplevel').stdout.trim();
const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
  .stdout.split('\0')
  .filter(Boolean);
if (!top || staged.length === 0) process.exit(0);

function bin(name) {
  for (const dir of [join(top, 'node_modules', '.bin'), join(here, '..', 'node_modules', '.bin')]) {
    if (existsSync(join(dir, name))) return join(dir, name);
  }
  console.warn(`pre-commit: ${name} is not installed here (run pnpm install); skipping it.`);
  return undefined;
}

function run(title, command, args) {
  if (!command) return true;
  const result = spawnSync(command, args, { cwd: top, encoding: 'utf8' });
  if (result.status === 0) return true;
  console.error(`pre-commit: ${title} failed`);
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) console.error(String(result.error));
  return false;
}

const lintable = staged.filter((file) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file));
const results = [
  run('prettier --check', bin('prettier'), ['--check', '--ignore-unknown', '--log-level', 'warn', ...staged]),
  lintable.length ? run('oxlint', bin('oxlint'), ['--deny-warnings', ...lintable]) : true,
];
if (results.includes(false)) {
  console.error('pre-commit: fix the files above (pnpm exec prettier --write <files>) and stage them again.');
  process.exit(1);
}
