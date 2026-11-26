#!/usr/bin/env node
// Claude Code PostToolUse hook (Edit|Write): formats the edited file with the repo's Prettier, so
// an agent never runs a separate format step. Silent, and never blocks the edit: files Prettier
// does not parse (.proto) or outside this checkout are skipped, and a failure only logs.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const file = input.tool_input?.file_path;
const FORMATTED = /\.(ts|tsx|mts|mjs|js|jsx|json|md|mdx|css|yaml|yml)$/;
if (typeof file !== 'string' || !FORMATTED.test(file)) process.exit(0);
// Prettier comes from the checkout that holds the file: this one or a worktree of it.
let owner = '';
try {
  owner = execFileSync('git', ['-C', dirname(file), 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: 3000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  process.exit(0);
}
const common = (dir) =>
  execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
    timeout: 3000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
if (common(owner) !== common(repo)) process.exit(0);
const result = spawnSync('pnpm', ['exec', 'prettier', '--write', '--log-level', 'warn', file], {
  cwd: owner,
  encoding: 'utf8',
  timeout: 20_000,
});
if (result.status !== 0 && result.stderr)
  process.stderr.write(`format-edited: ${result.stderr.slice(0, 500)}\n`);
process.exit(0);
