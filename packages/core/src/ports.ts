// Interfaces the driver needs; adapters implement them.
import type {
  AgentEvent,
  ContextStatus,
  ExternalMcpServer,
  McpEndpoint,
  ProviderCapabilities,
  Usage,
} from './agents.ts';
import type { CallCleanup } from './execution.ts';
import type { TraceScope } from './trace.ts';
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
  sandbox?: { allowed_domains?: string[]; allow_write?: string[] };
  /** Extra environment for the agent and its commands, e.g. a staged registry npmrc. */
  env?: Record<string, string>;
  /** Host variables to pass beyond the agent allowlist (a profile's `sandbox.pass_env`). */
  passEnv?: string[];
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
  /** Most input plus output tokens this call may use, for providers that report tokens, not dollars. */
  maxTokens?: number;
  /** Session to continue, for providers that can resume. */
  resume?: string;
  /** Keep the session on disk so a later call can resume it (chats). Off by default. */
  persistSession?: boolean;
  /** The backend's MCP server, when this call may start child tasks with `delegate`. */
  mcp?: McpEndpoint;
  /** A workspace agent's own MCP servers; all their tools are allowed, and the guard still screens them. */
  mcpServers?: readonly ExternalMcpServer[];
  /** For a delegate child: the span it hangs under, in its parent's trace. */
  traceParent?: TraceScope;
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

/**
 * Why a model call failed, so the caller can decide to wait, resume or stop. `no-result` is a
 * stream that ended without a result, or a CLI that exited unexpectedly: it is transient, and the
 * driver may retry it once (docs/state-machines.md).
 */
export type ModelFailure =
  'aborted' | 'timeout' | 'stalled' | 'budget' | 'rate-limited' | 'usage-limit' | 'no-result' | 'error';

export interface ModelRunner {
  run(request: ModelRun): Promise<ModelResult>;
  /** What this runner enforces. Absent: the provider defaults in PROVIDER_CAPABILITIES. */
  readonly capabilities?: ProviderCapabilities;
}

/**
 * The cleanup evidence a model call error carries when the call stopped early (ADR 0005). Errors
 * without it reported nothing uncertain.
 */
export function errorCleanup(error: unknown): CallCleanup | undefined {
  const cleanup = (error as { cleanup?: unknown } | null)?.cleanup as CallCleanup | undefined;
  return cleanup && (cleanup.status === 'clean' || cleanup.status === 'uncertain') ? cleanup : undefined;
}
