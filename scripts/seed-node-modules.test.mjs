import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneBlocker, moduleDirs } from './seed-node-modules.mjs';

function checkout(lock, withModules) {
  const dir = mkdtempSync(join(tmpdir(), 'seed-nm-'));
  writeFileSync(join(dir, 'pnpm-lock.yaml'), lock);
  if (withModules) {
    mkdirSync(join(dir, 'node_modules'));
    mkdirSync(join(dir, 'packages', 'a', 'node_modules'), { recursive: true });
    mkdirSync(join(dir, 'packages', 'b'), { recursive: true });
  }
  return dir;
}

test('clone is allowed only on macOS with a matching lockfile and a populated source', () => {
  const source = checkout('lock1', true);
  assert.equal(cloneBlocker(checkout('lock1', false), source, 'darwin'), undefined);
  assert.match(cloneBlocker(checkout('lock1', false), source, 'linux'), /APFS/);
  assert.match(cloneBlocker(checkout('lock2', false), source, 'darwin'), /lockfile differs/);
  assert.match(cloneBlocker(checkout('lock1', false), checkout('lock1', false), 'darwin'), /no node_modules/);
  assert.match(cloneBlocker(checkout('lock1', true), source, 'darwin'), /already has/);
});

test('moduleDirs lists the root and workspace packages that have node_modules', () => {
  assert.deepEqual(moduleDirs(checkout('x', true)), ['.', join('packages', 'a')]);
});
