// Small helpers the workflow modules share: output tails, limits, failure text, the worktree guard.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  DEFAULT_TASK_LIMITS,
  isForbiddenCommand,
  isForbiddenPath,
  type ModelFailure,
  type RepoProfile,
  type ToolGuard,
  FACTORY_PR_TEMPLATE,
  PR_TEMPLATE_PATHS,
  type PrTemplate,
} from '@factory/core';

export const OUTPUT_TAIL = 6000;
export const MAX_DIFF_CHARS = 200_000;
export const MAX_PR_DIFF_CHARS = 80_000;
export const MAX_PR_TASK_CHARS = 6_000;

export function tail(text: string, size = OUTPUT_TAIL): string {
  return text.length > size ? `…${text.slice(-size)}` : text;
}

export const MINUTE = 60_000;

export interface ProfileCheckStep {
  name: string;
  command?: string;
  outcome: 'passed' | 'failed' | 'skipped';
  duration_ms: number;
  output: string;
  /** Plain words when a failure is a machine fault, e.g. "a credential has expired or is missing". */
  environment?: string;
}
export interface ProfileCheckResult {
  passed: boolean;
  steps: ProfileCheckStep[];
}

/** "1 second", "40 seconds", "10 minutes": for messages about check limits. */
export function duration(ms: number): string {
  if (ms < MINUTE) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.round(ms / MINUTE);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Time and silence limits for setup and check commands. */
export function checkLimits(profile: RepoProfile) {
  const timeoutMs =
    (profile.limits?.check_timeout_minutes ?? DEFAULT_TASK_LIMITS.check_timeout_minutes) * MINUTE;
  const stallMs = Math.max(
    1,
    Math.round((profile.limits?.check_stall_minutes ?? DEFAULT_TASK_LIMITS.check_stall_minutes) * MINUTE),
  );
  return {
    timeoutMs,
    stallMs,
    /** Why a stopped command stopped, in words. */
    why: (stopped: 'timeout' | 'stalled') =>
      stopped === 'stalled'
        ? `printed nothing for ${duration(stallMs)}`
        : `did not finish within ${duration(timeoutMs)}`,
  };
}

/** The cost a failed model call reported, when it reported one. */
export function errorCost(error: unknown): number | null {
  const cost = (error as { costUsd?: unknown } | null)?.costUsd;
  return typeof cost === 'number' ? cost : null;
}

export function errorKind(error: unknown): ModelFailure | undefined {
  return (error as { kind?: ModelFailure } | null)?.kind;
}

/** A failure message that tells the human what to do next. */
export function failureText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  switch (errorKind(error)) {
    case 'usage-limit':
      return `${message}. The plan's usage limit was reached; run the task again after it resets.`;
    case 'aborted':
      return `${message}. Run the task again to continue from the last saved step.`;
    case 'timeout':
    case 'stalled':
      return `${message}. Run the task again to retry this step.`;
    default:
      return message;
  }
}

/** A TCP port that is free now, for a dev server the runtime check starts. */
export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

/** Keeps an editing agent inside its worktree, off forbidden paths and forbidden commands. */
export function worktreeGuard(worktree: string, profile: RepoProfile): ToolGuard {
  const root = resolve(worktree);
  return {
    check(toolName, input) {
      if (toolName === 'Bash') {
        const command = String(input.command ?? '');
        const forbidden = isForbiddenCommand(command, profile);
        return forbidden ? `The command "${forbidden}" is not allowed for the coder.` : undefined;
      }
      const raw = input.file_path ?? input.path ?? input.notebook_path;
      if (raw === undefined) return undefined;
      const target = resolve(root, String(raw));
      const rel = relative(root, target);
      if (rel.startsWith('..') || isAbsolute(rel) || rel === '..' || target.split(sep).includes('.git'))
        return `Only files inside the task worktree (${root}) may be used.`;
      if (
        (toolName === 'Edit' || toolName === 'Write') &&
        isForbiddenPath(rel, profile.confirmed.forbidden_paths)
      )
        return `The path "${rel}" is forbidden by the repository profile.`;
      return undefined;
    },
  };
}

/** The repository's PR template from the worktree, or the factory's when it has none. */
export async function readPrTemplate(dir: string): Promise<PrTemplate> {
  for (const path of PR_TEMPLATE_PATHS) {
    const text = await readFile(join(dir, path), 'utf8').catch(() => undefined);
    if (text?.trim()) return { source: path, text };
  }
  return { source: 'factory', text: FACTORY_PR_TEMPLATE };
}
