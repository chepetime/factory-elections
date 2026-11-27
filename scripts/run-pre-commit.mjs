#!/usr/bin/env node
// Git pre-commit runner (called by scripts/git-hooks/pre-commit). Blocks, and stays fast: Prettier
// and oxlint on the staged files only. The full changed-surface check runs after the commit lands
// on main (scripts/run-post-commit.mjs). Factory's own commits pass --no-verify and skip this.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });
// Configs the tools read from the repository root; exported from the index next to the staged files.
const CONFIGS = ['.prettierrc.json', '.prettierignore', '.oxlintrc.json', '.editorconfig', 'package.json'];

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

function run(title, command, args, cwd) {
  if (!command) return true;
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status === 0) return true;
  console.error(`pre-commit: ${title} failed`);
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) console.error(String(result.error));
  return false;
}

// Check the staged content (the index), not the working copy: unstaged edits of other agents in a
// shared checkout must not change the result. Export the index blobs to a temp tree and run there.
const tree = mkdtempSync(join(tmpdir(), 'factory-pre-commit-'));
let ok = false;
try {
  const configs = git('ls-files', '-z', '--', ...CONFIGS)
    .stdout.split('\0')
    .filter(Boolean);
  const exported = spawnSync('git', ['checkout-index', '-f', '-z', '--stdin', `--prefix=${tree}/`], {
    cwd: top,
    input: [...staged, ...configs].join('\0'),
    encoding: 'utf8',
  });
  if (exported.status !== 0) {
    console.error(`pre-commit: could not read the staged files\n${exported.stderr}`);
    rmSync(tree, { recursive: true, force: true });
    process.exit(1);
  }
  const lintable = staged.filter((file) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file));
  const results = [
    run(
      'prettier --check',
      bin('prettier'),
      ['--check', '--ignore-unknown', '--log-level', 'warn', ...staged],
      tree,
    ),
    lintable.length ? run('oxlint', bin('oxlint'), ['--deny-warnings', ...lintable], tree) : true,
  ];
  ok = !results.includes(false);
} finally {
  rmSync(tree, { recursive: true, force: true });
}
if (!ok) {
  console.error('pre-commit: fix the files above (pnpm exec prettier --write <files>) and stage them again.');
  process.exit(1);
}
