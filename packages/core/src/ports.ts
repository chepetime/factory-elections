// Interfaces the driver needs; adapters implement them.
import type { AgentEvent, ContextStatus, McpEndpoint, Usage } from './agents.ts';
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
  /** Session to continue, for providers that can resume. */
  resume?: string;
  /** Keep the session on disk so a later call can resume it (chats). Off by default. */
  persistSession?: boolean;
  /** The backend's MCP server, when this call may start child tasks with `delegate`. */
  mcp?: McpEndpoint;
  /** Receives the call's events as they happen. */
  onEvent?: (event: AgentEvent) => void;
  /** Watch for a turn stuck on one failure and redirect it once (providers with tool hooks). */
  loopGuard?: boolean;
  /** Warn at 80% of this context size, and tell the agent, where the provider reports it. */
  context?: { limit: number; onStatus?(status: ContextStatus): void };
}

export interface ModelResult {
  text: string;
  structured?: unknown;
  /** Null when the provider reports no cost (Codex reports tokens only). */
  costUsd: number | null;
  sessionId?: string;
  usage?: Usage;
}

/** Why a model call failed, so the caller can decide to wait, resume or stop. */
export type ModelFailure =
  'aborted' | 'timeout' | 'stalled' | 'budget' | 'rate-limited' | 'usage-limit' | 'error';

export interface ModelRunner {
  run(request: ModelRun): Promise<ModelResult>;
}
