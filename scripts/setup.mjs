#!/usr/bin/env node
// One-step local setup: install dependencies, put `factory` on PATH, run `factory doctor`.
// Usage: pnpm run setup [-- --no-install] [-- --no-doctor]
// FACTORY_BIN_DIR overrides the link directory (default ~/.local/bin).
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const target = join(root, 'bin', 'factory');
const binDir = resolve(process.env.FACTORY_BIN_DIR ?? join(homedir(), '.local', 'bin'));
const link = join(binDir, 'factory');

function fail(message) {
  console.error(`setup: ${message}`);
  process.exit(1);
}

function step(title) {
  console.log(`\n==> ${title}`);
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 26)
  fail(
    `Node.js 26 or later is required; found ${process.version}. Install it (e.g. \`mise use -g node@26\`).`,
  );

if (!args.has('--no-install')) {
  step('Installing dependencies (pnpm install --frozen-lockfile)');
  const install = spawnSync('pnpm', ['install', '--frozen-lockfile'], { cwd: root, stdio: 'inherit' });
  if (install.error)
    fail('pnpm was not found. Install it with `brew install pnpm` or `npm install -g pnpm`.');
  if (install.status !== 0) fail('pnpm install failed; see the output above.');
}

step(`Linking ${link} -> ${target}`);
mkdirSync(binDir, { recursive: true });
let existing;
try {
  existing = lstatSync(link);
} catch {
  existing = undefined;
}
if (existing && !existing.isSymbolicLink())
  fail(`${link} exists and is not a symbolic link; move it away and rerun.`);
if (existing && readlinkSync(link) !== target) console.log(`Replacing link to ${readlinkSync(link)}`);
if (existing) rmSync(link);
symlinkSync(target, link);
console.log('Linked.');

const onPath = (process.env.PATH ?? '').split(delimiter).some((dir) => dir && resolve(dir) === binDir);
if (!onPath) {
  console.log(`\n${binDir} is not on your PATH. Add this line to ~/.zshrc, then open a new terminal:`);
  console.log(`  export PATH="${binDir}:$PATH"`);
}

if (!args.has('--no-doctor')) {
  step('Checking prerequisites (factory doctor)');
  const doctor = spawnSync(process.execPath, [target, 'doctor'], { cwd: root, stdio: 'inherit' });
  if (doctor.status !== 0)
    fail('some checks failed; follow the fixes above, then run `factory doctor` again.');
}

console.log(`\nDone. Run \`factory --help\`${onPath ? '' : ' (after updating PATH)'} to get started.`);
