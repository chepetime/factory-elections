// One contract for every agent provider (Claude Code, Codex, …). Adapters describe what their
// provider can enforce; the backend refuses work a provider cannot do safely, instead of quietly
// running it with weaker controls.
import { z } from 'zod';
import type { ModelResult, ModelRun, ModelRunner } from './ports.ts';

export const ProviderId = z.enum(['claude', 'codex']);
export type ProviderId = z.infer<typeof ProviderId>;

/**
 * A model reference: a Claude model id (`claude-…`), or `codex` / `codex:<model>` for Codex with
 * its configured or a named model.
 */
export const ModelRef = z
  .string()
  .regex(/^(claude-[\w.-]+|codex(:[\w.-]+)?)$/, 'use a claude-… model id, codex or codex:<model>');
export type ModelRef = z.infer<typeof ModelRef>;

/** The provider and provider-side model a reference names. `model` is absent for the default. */
export function parseModelRef(ref: string): { provider: ProviderId; model?: string } {
  if (ref === 'codex') return { provider: 'codex' };
  if (ref.startsWith('codex:')) return { provider: 'codex', model: ref.slice('codex:'.length) };
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
  /** Reports what a call cost in dollars. */
  costReport: boolean;
  /** Returns a final answer that matches a JSON schema. */
  structuredOutput: boolean;
  /** Continues an earlier session by id. */
  resume: boolean;
  /** Calls tools on an MCP server (needed for `delegate`). */
  mcp: boolean;
}
export type Capability = keyof ProviderCapabilities;

export const PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  claude: {
    toolGuard: true,
    denyRules: true,
    osSandbox: true,
    budget: true,
    costReport: true,
    structuredOutput: true,
    resume: true,
    mcp: true,
  },
  // Codex rules match only a command's first words (a `bash -lc '…'` wrapper gets past them), and
  // it reports tokens, not dollars. Its OS sandbox is the control the factory relies on.
  codex: {
    toolGuard: false,
    denyRules: false,
    osSandbox: true,
    budget: false,
    costReport: false,
    structuredOutput: true,
    resume: true,
    mcp: true,
  },
};

const CAPABILITY_TEXT: Record<Capability, string> = {
  toolGuard: 'screen each tool call',
  denyRules: 'enforce command deny rules',
  osSandbox: 'run commands in an OS sandbox',
  budget: 'stop at a dollar limit',
  costReport: 'report cost',
  structuredOutput: 'return structured output',
  resume: 'continue a session',
  mcp: 'call MCP tools',
};

/** Undefined when the provider has every capability; otherwise why it cannot take the work. */
export function missingCapabilities(provider: ProviderId, needs: readonly Capability[]): string | undefined {
  const have = PROVIDER_CAPABILITIES[provider];
  const missing = needs.filter((n) => !have[n]);
  return missing.length
    ? `${provider} cannot ${missing.map((m) => CAPABILITY_TEXT[m]).join(', ')}, which this work needs`
    : undefined;
}

/** Token counts, for providers that report usage but not cost. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/** What any provider's event stream means, in one shape. */
export type AgentEvent =
  | { type: 'session'; id: string }
  /** `sub`: from a subagent, not the main agent. */
  | { type: 'text'; text: string; sub?: boolean }
  | { type: 'tool'; name: string; input: Record<string, unknown>; sub?: boolean }
  /** A tool call's outcome. `ok: false` is a failed call (an error, or a command's non-zero exit). */
  | { type: 'tool-result'; ok: boolean; text: string; sub?: boolean }
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
}

export interface McpEndpoint {
  url: string;
  token: string;
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
  provider: ProviderId.describe('Which agent runs the child task'),
  task: z.string().trim().min(1).max(50_000).describe('What the child must do, with all context it needs'),
  access: z
    .enum(['read-only', 'edit'])
    .default('read-only')
    .describe('read-only: may only read the repository. edit: may change files in the working directory'),
  model: z.string().max(100).optional().describe('Provider model; omit for the default'),
  budget_usd: z.number().positive().max(100).optional().describe('Most the child may spend'),
});
export type DelegateInput = z.infer<typeof DelegateInput>;

/** What a model call needs from its provider. A missing dollar limit is allowed: time limits still hold. */
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
    if (!this.runners[provider]) return `${provider} is not available on this backend`;
    return missingCapabilities(provider, callNeeds(request));
  }
  async run(request: ModelRun): Promise<ModelResult> {
    const refusal = this.refusal(request);
    if (refusal) throw new ProviderRefused(`${request.step ?? 'model call'}: ${refusal}`);
    return this.runners[this.provider(request)]!.run(request);
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
