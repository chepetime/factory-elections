// Interfaces the driver needs; adapters implement them.
import type { Effort } from './schemas.ts';

export type ToolAccess = 'none' | 'read-only' | 'edit';

export interface ToolGuard {
  /** Returns a denial message, or undefined to allow the tool call. */
  check(toolName: string, input: Record<string, unknown>): string | undefined;
}

export interface ModelRun {
  model: string;
  effort: Effort;
  systemPrompt: string;
  prompt: string;
  cwd?: string;
  tools: ToolAccess;
  guard?: ToolGuard;
  outputSchema?: Record<string, unknown>;
  maxTurns?: number;
}

export interface ModelResult {
  text: string;
  structured?: unknown;
  costUsd: number | null;
}

export interface ModelRunner {
  run(request: ModelRun): Promise<ModelResult>;
}
