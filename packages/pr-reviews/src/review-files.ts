// The review records on disk (run.json and its turns), worktree paths, and bounded log readers.
import { open, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { ProjectName } from '@factory/core';

export const PrNumber = z.number().int().positive().max(1_000_000_000);
export const ReviewTarget = z.object({ project: ProjectName, number: PrNumber });
export const ReviewMode = z.enum(['review', 'rereview']);
export type ReviewMode = z.infer<typeof ReviewMode>;
export const Turn = z.object({
  at: z.string(),
  text: z.string(),
  label: z.string().optional(),
  /** The detached CLI process group of the turn. */
  pid: z.number().int().positive().optional(),
  /** The backend instance that runs the turn in-process; a new instance has not started it. */
  owner: z.string().max(100).optional(),
  stopped: z.boolean().optional(),
  /** Set when the backend stopped the turn, not the user. */
  stop_reason: z.enum(['stalled']).optional(),
  /** The turn's span in the trace ledger; its children hang under it. */
  trace_id: z.string().optional(),
  span_id: z.string().optional(),
  /** The cheap screen's plan for the review: depth, model, why, and what the screen cost. */
  screen: z
    .object({
      depth: z.enum(['sonnet', 'opus']),
      model: z.string(),
      reason: z.string(),
      screened: z.boolean(),
      max_score: z.number().optional(),
      cost_usd: z.number().optional(),
    })
    .optional(),
});
export const RunFile = z.object({
  number: PrNumber,
  branch: z.string().min(1),
  url: z.string(),
  title: z.string().optional(),
  worktree: z.string(),
  started_at: z.string(),
  session_id: z.string().optional(),
  turns: z.array(Turn).min(1),
});
export type RunFile = z.infer<typeof RunFile>;

export function reviewWorktree(repo: string, branch: string) {
  return {
    path: join(dirname(repo), 'reviews', `${basename(repo)}-${branch.replaceAll('/', '-')}`),
    branch: `review/${branch}`,
  };
}

/** Whether git lists this worktree. Git reports resolved paths (e.g. /private/var on macOS). */
export async function registered(worktrees: readonly string[], path: string): Promise<boolean> {
  if (worktrees.includes(path)) return true;
  const real = await realpath(path).catch(() => undefined);
  return real !== undefined && worktrees.includes(real);
}

/** Lines of a stream-json log, keeping at most the last `bytes`. */
export async function readLines(path: string, bytes = 4 * 1024 * 1024): Promise<string[]> {
  const file = await open(path, 'r').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!file) return [];
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await file.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim() !== '');
  } finally {
    await file.close();
  }
}

/** The first lines of a file, reading at most `bytes`. */
export async function headLines(path: string, bytes = 64 * 1024): Promise<string[]> {
  const file = await open(path, 'r').catch(() => undefined);
  if (!file) return [];
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (bytesRead === bytes) lines.pop();
    return lines.filter((l) => l.trim() !== '');
  } finally {
    await file.close();
  }
}

/** The skill text without its YAML frontmatter. */
export function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n/, '').trimStart();
}
