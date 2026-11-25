import 'server-only';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

// `next dev` and `next build` run in apps/docs.
export const repoRoot = join(process.cwd(), '..', '..');

/** Reads a git-tracked file. Untracked, ignored, or outside paths return null, so local secrets stay hidden. */
export async function readTrackedFile(path: string): Promise<string | null> {
  const normalized = posix.normalize(path);
  if (normalized.startsWith('..') || posix.isAbsolute(normalized)) return null;
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', normalized], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return await readFile(join(repoRoot, normalized), 'utf8');
  } catch {
    return null;
  }
}

/** Lists the direct children of a tracked folder, folders first. Returns null when nothing under it is tracked. */
export function listTrackedFolder(path: string): string[] | null {
  const folder = posix.normalize(path).replace(/\/$/, '');
  if (folder.startsWith('..') || posix.isAbsolute(folder)) return null;
  const files = execFileSync('git', ['ls-files', '--', `${folder}/`], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  if (files.length === 0) return null;
  const children = new Set(
    files.map((file) => {
      const [first, ...rest] = file.slice(folder.length + 1).split('/');
      return rest.length > 0 ? `${first}/` : first!;
    }),
  );
  return [...children].sort(
    (a, b) => Number(b.endsWith('/')) - Number(a.endsWith('/')) || a.localeCompare(b),
  );
}
