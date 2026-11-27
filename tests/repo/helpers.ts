import { globSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo-rule tests only read files and use only Node built-ins, so they run on every
// CI plan, including documentation-only changes, without installed dependencies.
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function files(pattern: string): string[] {
  return globSync(pattern, { cwd: root }).sort();
}

export function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}
