// One contract for every agent provider (Claude Code, Codex, …). Adapters describe what their
// provider can enforce; the backend refuses work a provider cannot do safely, instead of quietly
// running it with weaker controls.
import { z } from 'zod';
import type { ModelResult, ModelRun, ModelRunner } from './ports.ts';
import { tokenCapForModel } from './prices.ts';

export const ProviderId = z.enum(['claude', 'codex', 'pi']);
export type ProviderId = z.infer<typeof ProviderId>;

/**
 * A model reference: a Claude model id (`claude-…`), or `codex` / `codex:<model>` for Codex with
 * its configured or a named model.
 */
export const ModelRef = z
  .string()
  .regex(
    /^(claude-[\w.-]+|codex(:[\w.-]+)?|pi:[\w.-]+\/[\w./-]+)$/,
    'use a Claude model id, codex[:<model>], or pi:<provider>/<model>',
  );
export type ModelRef = z.infer<typeof ModelRef>;

/** The provider and provider-side model a reference names. `model` is absent for the default. */
export function parseModelRef(ref: string): { provider: ProviderId; model?: string } {
  if (ref === 'codex') return { provider: 'codex' };
  if (ref.startsWith('codex:')) return { provider: 'codex', model: ref.slice('codex:'.length) };
  if (ref.startsWith('pi:')) return { provider: 'pi', model: ref.slice('pi:'.length) };
  return { provider: 'claude', model: ref };
}

/** What a provider enforces itself. The backend checks these before it gives the provider work. */
export interface ProviderCapabilities {
  /** Every tool call can be screened by a callback before it runs (the step guard). */
  toolGuard: boolean;
  /** Command deny rules that also hold for compound and nested commands. */
  denyRules: boolean;
  /** An OS sandbox that limits file writes and network for commands. */
  osSandbox: boolean;
  /** Stops a call at a dollar limit. */
  budget: boolean;
  /** Stops a call at a token limit while it runs (a dollar limit becomes one: see `tokenCapForModel`). */
  tokenCap: boolean;
  /** Reports what a call cost in dollars. */
  costReport: boolean;
  /** Returns a final answer that matches a JSON schema. */
  structuredOutput: boolean;
  /** Continues an earlier session by id. */
  resume: boolean;
  /** Calls tools on an MCP server (needed for `delegate`). */
  mcp: boolean;
  /** Stops a running call on request. */
  interrupt: boolean;
  /** Takes extra input while a turn runs and says whether it was accepted (SupplementReceipt). */
  supplementalInput: boolean;
  /** Tool events carry native call ids, so results pair with their calls. */
  callIds: boolean;
  /** A stopped call is verified to stop the commands it started, not only the provider process. */
  descendantCleanup: boolean;
}
export type Capability = keyof ProviderCapabilities;

export const PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  claude: {
    toolGuard: true,
    denyRules: true,
    osSandbox: true,
    budget: true,
    tokenCap: false,
    costReport: true,
    structuredOutput: true,
    resume: true,
    mcp: true,
    interrupt: true,
    supplementalInput: false,
    callIds: true,
    // Verified for a shell tool on the SDK path (docs/runtime-baseline.md).
    descendantCleanup: true,
  },
  // Codex rules match only a command's first words (a `bash -lc '…'` wrapper gets past them), and
  // it reports tokens, not dollars. Its OS sandbox is the control the factory relies on.
  codex: {
    toolGuard: false,
    denyRules: false,
    osSandbox: true,
    budget: false,
    tokenCap: false,
    costReport: false,
    structuredOutput: true,
    resume: true,
    mcp: true,
    interrupt: true,
    supplementalInput: false,
    callIds: true,
    // A cancelled `codex exec` leaves its shell command running (docs/runtime-baseline.md).
    descendantCleanup: false,
  },
  pi: {
    toolGuard: false,
    denyRules: false,
    osSandbox: false,
    budget: false,
    tokenCap: false,
    costReport: true,
    structuredOutput: false,
    resume: false,
    mcp: false,
    interrupt: true,
    supplementalInput: false,
    callIds: false,
    descendantCleanup: false,
  },
};

const CAPABILITY_TEXT: Record<Capability, string> = {
  toolGuard: 'screen each tool call',
  denyRules: 'enforce command deny rules',
  osSandbox: 'run commands in an OS sandbox',
  budget: 'stop at a dollar limit',
  tokenCap: 'stop at a token limit',
  costReport: 'report cost',
  structuredOutput: 'return structured output',
  resume: 'continue a session',
  mcp: 'call MCP tools',
  interrupt: 'stop a running call',
  supplementalInput: 'take input during a turn',
  callIds: 'report tool call ids',
  descendantCleanup: 'stop the commands it started when stopped',
};

/**
 * The provider runtime versions the adapters were last checked against (phase 0 baseline). Each
 * entry point runs its own binary: SDK tasks use the Claude Code that the SDK package bundles,
 * detached review turns the `claude` on PATH, and Codex runs the `codex` on PATH. Another version
 * may work, but its lifecycle behavior is not verified. Update a pin only with new fixtures.
 */
export const TESTED_RUNTIMES = {
  /** `@anthropic-ai/claude-agent-sdk`, pinned by the lockfile. */
  claudeAgentSdk: '0.3.323',
  /** The Claude Code binary that SDK version bundles. */
  claudeSdkCli: '2.1.323',
  /** `claude` on PATH, for detached review turns. */
  claudeCli: '2.1.331',
  /** `codex` on PATH. */
  codexCli: '0.172.0',
} as const;

/** The first x.y.z version in a `--version` line, e.g. `2.1.331 (Claude Code)` or `codex-cli 0.172.0`. */
export function parseVersion(output: string): string | undefined {
  return /\b(\d+\.\d+\.\d+)\b/.exec(output)?.[1];
}

/** Undefined when the provider has every capability; otherwise why it cannot take the work. */
export function missingCapabilities(
  provider: ProviderId,
  needs: readonly Capability[],
  have: ProviderCapabilities = PROVIDER_CAPABILITIES[provider],
): string | undefined {
  const missing = needs.filter((n) => !have[n]);
  return missing.length
    ? `${provider} cannot ${missing.map((m) => CAPABILITY_TEXT[m]).join(', ')}, which this work needs`
    : undefined;
}

/** Token counts, for providers that report usage but not cost. */
export interface Usage {
  /** Every input token, cache reads and writes included, the same for each provider. */
  inputTokens: number;
  outputTokens: number;
  /** The part of `inputTokens` read from the prompt cache. */
  cachedInputTokens?: number;
  /** The part of inputTokens written to the prompt cache. */
  cacheWriteInputTokens?: number;
}

/**
 * Native identity of a tool call, where the provider gives one. `callId` pairs a call with its
 * result; `parentCallId` is the call (a subagent's Agent tool call) that the event runs under.
 * Both are absent in events recorded before they existed.
 */
export interface ToolCallIds {
  callId?: string;
  parentCallId?: string;
}

/** What any provider's event stream means, in one shape. */
export type AgentEvent =
  | { type: 'session'; id: string }
  /** `sub`: from a subagent, not the main agent. */
  | { type: 'text'; text: string; sub?: boolean }
  | ({ type: 'tool'; name: string; input: Record<string, unknown>; sub?: boolean } & ToolCallIds)
  /** A tool call's outcome. `ok: false` is a failed call (an error, or a command's non-zero exit). */
  | ({ type: 'tool-result'; ok: boolean; text: string; sub?: boolean } & ToolCallIds)
  /** Tokens the model read for one request: the session's context size at that point. */
  | { type: 'context'; tokens: number }
  /** A loop-guard judgement: a small model decided whether the turn is stuck. */
  | {
      type: 'judge';
      stuck: boolean;
      confidence: number;
      costUsd: number | null;
      startedAt: string;
      durationMs: number;
    }
  | {
      type: 'result';
      ok: boolean;
      text: string;
      costUsd?: number;
      durationMs?: number;
      usage?: Usage;
      sessionId?: string;
    };

/** One headless agent turn, as a command line. The command writes JSONL events to stdout. */
export interface HeadlessTurn {
  /** Provider-side model; absent for the provider's default. */
  model?: string;
  message: string;
  /** Extra system instructions, as a file the provider reads. */
  systemPromptFile: string;
  /** Session to continue; absent for a new one. */
  resume?: string;
  /** Most this turn may spend, for providers with a budget. */
  budgetUsd?: number;
  /** Tool rules this turn may not use (Claude rule syntax, e.g. `Bash(git push:*)`). */
  deny: readonly string[];
  /** The backend's MCP server for `delegate`, when this turn may start child tasks. */
  mcp?: McpEndpoint;
  /** Built-in tools to offer; absent: the provider's default set. */
  tools?: readonly string[];
  /**
   * Run the turn's commands in an OS sandbox, for providers that have one. Writes are limited to
   * `allowWrite`; the network to `allowedDomains` (none when absent); credential stores are
   * unreadable. Deny rules alone are not a boundary, so a turn that reads untrusted text sets this.
   */
  sandbox?: { allowWrite: readonly string[]; allowedDomains?: readonly string[] };
}

export interface McpEndpoint {
  url: string;
  token: string;
  /** Factory tools this grant serves besides `delegate`, e.g. `comment` and `set_status`. */
  tools?: readonly string[];
}

/** A factory tool that one MCP grant serves, e.g. `comment` for an agent working a task. */
export interface FactoryTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: unknown): Promise<{ text: string; isError?: boolean }>;
}

/** An agent's own HTTP MCP server. The token is resolved on the backend, never stored. */
export interface ExternalMcpServer {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

/** A provider's headless CLI: how to start a turn, and how to read what it writes. */
export interface AgentCli {
  id: ProviderId;
  command: string;
  args(turn: HeadlessTurn, extra: { systemPrompt: string }): string[];
  /** Environment additions for the turn (credentials stay the machine's own). */
  env?(turn: HeadlessTurn): Record<string, string>;
  /** The events in one output line. Lines that are not provider JSON give no events. */
  parse(line: string): AgentEvent[];
}

/** The id of the session a turn ran in, from its events. */
export function eventSession(events: readonly AgentEvent[]): string | undefined {
  for (const e of events) {
    if (e.type === 'session') return e.id;
    if (e.type === 'result' && e.sessionId) return e.sessionId;
  }
  return undefined;
}

/** The `delegate` tool's input, as every provider sends it. */
export const DelegateInput = z.object({
  provider: ProviderId.exclude(['pi']).describe('Which agent runs the child task'),
  task: z.string().trim().min(1).max(50_000).describe('What the child must do, with all context it needs'),
  access: z
    .enum(['read-only', 'edit'])
    .default('read-only')
    .describe('read-only: may only read the repository. edit: may change files in the working directory'),
  model: z.string().max(100).optional().describe('Provider model; omit for the default'),
  budget_usd: z.number().positive().max(100).optional().describe('Most the child may spend'),
});
export type DelegateInput = z.infer<typeof DelegateInput>;

/**
 * What a model call needs from its provider. A missing limit is allowed: time limits still hold.
 * A dollar or token limit is checked in `ProviderRouter.refusal`: either one stops it.
 */
export function callNeeds(request: ModelRun): Capability[] {
  const needs: Capability[] = [];
  if (request.guard) needs.push('toolGuard');
  if (request.outputSchema) needs.push('structuredOutput');
  if (request.resume) needs.push('resume');
  if (request.mcp) needs.push('mcp');
  return needs;
}

export class ProviderRefused extends Error {}

/** One ModelRunner over every provider: `model` names the provider (see ModelRef). */
export class ProviderRouter implements ModelRunner {
  readonly runners: Partial<Record<ProviderId, ModelRunner>>;
  constructor(runners: Partial<Record<ProviderId, ModelRunner>>) {
    this.runners = runners;
  }
  provider(request: ModelRun): ProviderId {
    return parseModelRef(request.model).provider;
  }
  /** Why this provider cannot take the call, or undefined when it can. */
  refusal(request: ModelRun): string | undefined {
    const provider = this.provider(request);
    const runner = this.runners[provider];
    if (!runner) return `${provider} is not available on this backend`;
    const have = runner.capabilities ?? PROVIDER_CAPABILITIES[provider];
    const unbounded =
      request.maxTokens !== undefined
        ? !have.tokenCap
        : request.maxBudgetUsd !== undefined && !have.budget && !have.tokenCap;
    if (unbounded)
      return `${provider} cannot stop at a ${request.maxTokens !== undefined ? 'token' : 'dollar'} limit, and this call has one that nothing else would enforce`;
    if (
      !have.budget &&
      have.tokenCap &&
      request.maxBudgetUsd !== undefined &&
      request.maxTokens === undefined &&
      tokenCapForModel(request.model, request.maxBudgetUsd) === null
    )
      return `${request.model} has no entry in the price table, so its dollar limit cannot become a token cap`;
    return missingCapabilities(provider, callNeeds(request), have);
  }
  async run(request: ModelRun): Promise<ModelResult> {
    const refusal = this.refusal(request);
    if (refusal) throw new ProviderRefused(`${request.step ?? 'model call'}: ${refusal}`);
    const provider = this.provider(request);
    const runner = this.runners[provider]!;
    const have = runner.capabilities ?? PROVIDER_CAPABILITIES[provider];
    // A provider that counts tokens, not dollars, gets the dollar limit as a token cap.
    const bound =
      !have.budget && have.tokenCap && request.maxBudgetUsd !== undefined && request.maxTokens === undefined
        ? { ...request, maxTokens: tokenCapForModel(request.model, request.maxBudgetUsd) ?? undefined }
        : request;
    return runner.run(bound);
  }
}

/** Where the "dumb zone" starts for current models: quality falls as context grows past it. */
export const DEFAULT_CONTEXT_TOKENS = Number(process.env.FACTORY_CONTEXT_TOKENS ?? 150_000);
/** Share of the context limit at which the factory warns. */
export const CONTEXT_WARN_SHARE = 0.8;

/**
 * Context limits: one number for everything, or per provider and model. The most specific entry
 * wins: the exact model reference, then the provider, then `default`.
 */
export const ContextLimits = z.union([
  z.number().int().min(10_000).max(2_000_000),
  z.record(z.string(), z.number().int().min(10_000).max(2_000_000)),
]);
export type ContextLimits = z.infer<typeof ContextLimits>;

export function contextLimit(limits: ContextLimits | undefined, model: string): number {
  if (typeof limits === 'number') return limits;
  const { provider } = parseModelRef(model);
  return limits?.[model] ?? limits?.[provider] ?? limits?.default ?? DEFAULT_CONTEXT_TOKENS;
}

export interface ContextStatus {
  tokens: number;
  limit: number;
  /** At or past CONTEXT_WARN_SHARE of the limit. */
  warn: boolean;
  /** At or past the limit. */
  over: boolean;
}

export function contextStatus(tokens: number, limit: number): ContextStatus {
  return { tokens, limit, warn: tokens >= limit * CONTEXT_WARN_SHARE, over: tokens >= limit };
}

export function contextWarning(status: ContextStatus): string {
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  return status.over
    ? `Context is ${k(status.tokens)} tokens, past the ${k(status.limit)} limit: quality drops from here. Finish or hand off the work.`
    : `Context is ${k(status.tokens)} tokens, ${Math.round((status.tokens / status.limit) * 100)}% of the ${k(status.limit)} limit. Wrap up soon or hand off the rest.`;
}
