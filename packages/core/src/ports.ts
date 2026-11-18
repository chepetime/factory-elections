// Interfaces the driver needs; adapters implement them.
import type { Effort } from './schemas.ts';

export type ToolAccess = 'none' | 'read-only' | 'edit';

export interface ToolGuard {
  /** Returns a denial message, or undefined to allow the tool call. */
  check(toolName: string, input: Record<string, unknown>): string | undefined;
}

export interface ModelRun {
  /** The workflow step making the request, for logs and test doubles. */
  step?: string;
  model: string;
  effort: Effort;
  systemPrompt: string;
  prompt: string;
  cwd?: string;
  tools: ToolAccess;
  guard?: ToolGuard;
  outputSchema?: Record<string, unknown>;
  maxTurns?: number;
  /** Stops the call when aborted (shutdown, or the run's owner gave up). */
  signal?: AbortSignal;
  /** Wall-clock limit for the whole call. */
  timeoutMs?: number;
  /** Stops the call after this long with no message from the model. */
  stallMs?: number;
  /** Most this call may spend. */
  maxBudgetUsd?: number;
}

export interface ModelResult {
  text: string;
  structured?: unknown;
  costUsd: number | null;
}

/** Why a model call failed, so the caller can decide to wait, resume or stop. */
export type ModelFailure =
  'aborted' | 'timeout' | 'stalled' | 'budget' | 'rate-limited' | 'usage-limit' | 'error';

export interface ModelRunner {
  run(request: ModelRun): Promise<ModelResult>;
}
