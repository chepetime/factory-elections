#!/usr/bin/env node
// Seeds a worktree's node_modules from the main checkout with an APFS copy-on-write clone
// (`cp -cR`), then runs a frozen offline install to fix links. Falls back to a normal frozen
// install off macOS, when the lockfiles differ, or when the source has no node_modules.
// Usage: node scripts/seed-node-modules.mjs [worktree=cwd] [source=main checkout]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const LOCK = 'pnpm-lock.yaml';

/** Directories that may hold a node_modules: the root plus each workspace package. */
export function moduleDirs(root) {
  const dirs = ['.'];
  for (const group of ['packages', 'apps']) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) dirs.push(join(group, name));
  }
  return dirs.filter((dir) => existsSync(join(root, dir, 'node_modules')));
}

/** Returns why a clone is not possible, or undefined when it is. */
export function cloneBlocker(worktree, source, platform = process.platform) {
  if (platform !== 'darwin') return 'clone needs APFS (macOS)';
  if (!existsSync(join(source, 'node_modules'))) return 'source has no node_modules';
  if (!existsSync(join(source, LOCK)) || !existsSync(join(worktree, LOCK))) return 'lockfile missing';
  if (readFileSync(join(source, LOCK), 'utf8') !== readFileSync(join(worktree, LOCK), 'utf8'))
    return 'lockfile differs from the main checkout';
  if (existsSync(join(worktree, 'node_modules'))) return 'worktree already has node_modules';
  return undefined;
}

function pnpm(cwd, ...args) {
  return spawnSync('pnpm', ['install', '--frozen-lockfile', ...args], { cwd, stdio: 'inherit' }).status === 0;
}

/** Clones what it can and installs. Returns 'cloned' or 'installed'; throws when install fails. */
export function seedNodeModules(worktree, source) {
  const blocker = cloneBlocker(worktree, source);
  if (blocker) {
    console.error(`seed: ${blocker}; running a normal install`);
    if (!pnpm(worktree)) throw new Error('pnpm install --frozen-lockfile failed');
    return 'installed';
  }
  try {
    for (const dir of moduleDirs(source)) {
      execFileSync('cp', ['-cR', join(source, dir, 'node_modules'), join(worktree, dir, 'node_modules')], {
        stdio: 'inherit',
      });
    }
  } catch (error) {
    console.error(`seed: clone failed (${error.message}); running a normal install`);
    if (!pnpm(worktree)) throw new Error('pnpm install --frozen-lockfile failed');
    return 'installed';
  }
  // The clone matches the lockfile, so offline is enough; go online only if the store lacks something.
  if (!pnpm(worktree, '--offline') && !pnpm(worktree))
    throw new Error('pnpm install --frozen-lockfile failed');
  return 'cloned';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const worktree = resolve(process.argv[2] ?? process.cwd());
    const source =
      process.argv[3] ??
      dirname(
        resolve(
          worktree,
          execFileSync('git', ['-C', worktree, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim(),
        ),
      );
    const started = Date.now();
    const how = seedNodeModules(worktree, resolve(source));
    console.log(`seed: ${how} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    console.error(`seed: ${error.message}`);
    process.exitCode = 1;
  }
}
