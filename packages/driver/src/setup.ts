// When a worktree's dependencies must be installed again: a hash of its setup inputs (lockfiles).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_SETUP_INPUTS } from '@factory/core';

/** Hash of the setup inputs in a worktree; a missing file counts as absent, not as an error. */
export async function setupInputsKey(
  path: string,
  inputs: readonly string[] = DEFAULT_SETUP_INPUTS,
): Promise<string> {
  const hash = createHash('sha256');
  for (const file of inputs) {
    const content = await readFile(resolve(path, file)).catch(() => undefined);
    hash.update(`${file}\0${content ? createHash('sha256').update(content).digest('hex') : '-'}\0`);
  }
  return hash.digest('hex');
}
