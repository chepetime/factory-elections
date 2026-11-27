// Model runner backed by the Claude Agent SDK. Authentication is the machine's own Claude sign-in
// (or ANTHROPIC_API_KEY); this adapter stores no credentials.
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  query,
  type HookCallbackMatcher,
  type Options,
  type PostToolUseFailureHookInput,
  type SandboxSettings,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  contextStatus,
  contextWarning,
  LOOP_JUDGE_PROMPT,
  LOOP_JUDGE_SCHEMA,
  LoopGuard,
  modelFailureKind,
  PROVIDER_CAPABILITIES,
  agentEnvironment,
  envNames,
  type LoopJudgement,
  type ModelFailure,
  type ModelResult,
  type ModelRun,
  type ModelRunner,
  type ToolAccess,
} from '@factory/core';
import { CLAUDE_DELEGATE_TOOL, claudeMcpConfig, claudeMessageEvents, MCP_TOOL_TIMEOUT_MS } from './cli.ts';

export * from './cli.ts';
export * from './turn.ts';

/** The built-in Claude tools each tool access level allows. */
export const CLAUDE_TOOL_ACCESS: Record<ToolAccess, string[]> = {
  none: [],
  'read-only': ['Read', 'Grep', 'Glob'],
  // Agent lets the coder hand parts of a task to subagents. Their tool calls reach canUseTool too
  // (with an agentID), so the step guard, the sandbox and the call's budget cover them.
  edit: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'Agent'],
};

/** Package registries a sandboxed coder may reach, so it can update a lockfile. */
export const SANDBOX_ALLOWED_DOMAINS = ['registry.npmjs.org'];

/**
 * OS sandbox for steps that may run Bash. A first guardrail, to be widened deliberately: commands
 * can write only inside the working directory (the task worktree) and the package-manager caches,
 * and reach only the package registries. The step guard still screens every command, because
 * sandboxed Bash is not auto-approved, and the model cannot opt a command out of the sandbox.
 */
const PNPM_LOCK_DIRS = ['/private/tmp', '/tmp'].map(
  (dir) => `${dir}/pnpm-store-operation-locks-${process.getuid?.() ?? 0}`,
);

export function sandboxFor(
  tools: ToolAccess,
  home: string = homedir(),
  extra?: ModelRun['sandbox'],
): SandboxSettings | undefined {
  if (!CLAUDE_TOOL_ACCESS[tools].includes('Bash')) return undefined;
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: [...SANDBOX_ALLOWED_DOMAINS, ...(extra?.allowed_domains ?? [])] },
    filesystem: {
      denyRead: [
        join(home, '.ssh'),
        join(home, '.npmrc'),
        join(home, '.aws'),
        join(home, '.config', 'gh'),
        join(home, 'Library', 'Keychains'),
      ],
      allowWrite: [
        join(home, 'Library', 'pnpm'),
        join(home, 'Library', 'Caches', 'pnpm'),
        join(home, '.npm'),
        join(home, '.cache'),
        // pnpm 12 locks its store under /tmp (not $TMPDIR); without it every install fails with
        // ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK.
        ...PNPM_LOCK_DIRS,
        ...(extra?.allow_write ?? []),
      ],
    },
  };
}

/** What a call was seen to do before it failed: the evidence a retry decision reads. */
export interface CallActivity {
  /** Assistant messages received: the model accepted the turn and produced output. */
  assistantMessages: number;
  /** Tool calls the model made. Any one of them may have had a side effect. */
  toolCalls: number;
}

export class ModelRunError extends Error {
  readonly costUsd: number | null;
  readonly kind: ModelFailure;
  /** Absent when the error did not come from a call (an abort before it started). */
  readonly activity: CallActivity | undefined;
  constructor(
    message: string,
    costUsd: number | null = null,
    kind: ModelFailure = modelFailureKind(message),
    activity?: CallActivity,
  ) {
    super(message);
    this.costUsd = costUsd;
    this.kind = kind;
    this.activity = activity;
  }
}

/**
 * A rate-limited call may run again only when there is evidence it did no work: no assistant
 * output, no tool call and no reported spend. Unknown cost is not zero cost, and zero cost is not
 * proof of no side effect, so the activity decides and a positive cost only adds a reason not to.
 */
export function canRetryRateLimit(error: unknown): boolean {
  if (!(error instanceof ModelRunError) || error.kind !== 'rate-limited' || !error.activity) return false;
  if (error.activity.assistantMessages > 0 || error.activity.toolCalls > 0) return false;
  return !(typeof error.costUsd === 'number' && error.costUsd > 0);
}

/** The model that judges whether a turn is stuck: small, since it reads a few failures. */
export const LOOP_JUDGE_MODEL = process.env.FACTORY_LOOP_JUDGE_MODEL ?? 'claude-haiku-5-5';

/** Waits before each retry of a rate-limited call that showed no activity (see canRetryRateLimit). */
export const RATE_LIMIT_RETRY_MS = [30_000, 120_000];

export interface ClaudeRunnerOptions {
  /** Receives one short line per assistant tool call, for progress output. */
  onProgress?: (line: string) => void;
  /** The SDK's query function; tests pass a fake. */
  query?: typeof query;
  retryDelaysMs?: readonly number[];
  /** How often the stall check looks at the last message time. */
  stallCheckMs?: number;
  /**
   * The silence allowed while a tool call is open (a long Bash run, a delegated child task): the
   * model sends nothing meanwhile. Default 4 x the call's stallMs, capped by its timeoutMs. A hung
   * tool still stops.
   */
  openToolStallMs?: number;
}

/** A tool call the model started and has not yet seen a result for. */
export interface OpenTool {
  name: string;
  since: number;
}

const LIMIT_REASONS = ['aborted', 'timeout', 'stalled'] as const;
type LimitReason = (typeof LIMIT_REASONS)[number];
const LIMIT_TEXT: Record<LimitReason, string> = {
  aborted: 'model run stopped: the backend is shutting down or the run was cancelled',
  timeout: 'model run stopped: it reached its time limit',
  stalled: 'model run stopped: no message from the model within the stall limit',
};

/** Resolves after `ms`, or rejects at once when the signal aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done, fail) => {
    if (signal?.aborted) return fail(new ModelRunError(LIMIT_TEXT.aborted, null, 'aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      done();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      fail(new ModelRunError(LIMIT_TEXT.aborted, null, 'aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class ClaudeAgentRunner implements ModelRunner {
  readonly options: ClaudeRunnerOptions;
  readonly capabilities = PROVIDER_CAPABILITIES.claude;
  constructor(options: ClaudeRunnerOptions = {}) {
    this.options = options;
  }

  /**
   * One call, retried only when the provider rate-limited it before the model produced output or
   * called a tool: then a retry cannot repeat a side effect.
   */
  async run(request: ModelRun): Promise<ModelResult> {
    const delays = this.options.retryDelaysMs ?? RATE_LIMIT_RETRY_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.runOnce(request);
      } catch (error) {
        if (!canRetryRateLimit(error) || attempt >= delays.length) throw error;
        this.options.onProgress?.(`  · rate limited; retrying in ${Math.round(delays[attempt]! / 1000)}s`);
        await pause(delays[attempt]!, request.signal);
      }
    }
  }

  /** Asks a small model whether a turn is stuck. Its cost is added to the turn's cost. */
  private async judge(evidence: string, signal?: AbortSignal): Promise<LoopJudgement> {
    const result = await this.runOnce({
      step: 'loop-guard',
      model: LOOP_JUDGE_MODEL,
      effort: 'low',
      tools: 'none',
      systemPrompt: LOOP_JUDGE_PROMPT,
      prompt: `Recent failures, oldest first:\n<failures>\n${evidence}\n</failures>`,
      outputSchema: LOOP_JUDGE_SCHEMA as unknown as Record<string, unknown>,
      maxBudgetUsd: 0.05,
      timeoutMs: 60_000,
      ...(signal ? { signal } : {}),
    });
    const verdict = (result.structured ?? {}) as Partial<LoopJudgement>;
    return {
      stuck: verdict.stuck === true,
      confidence: Number(verdict.confidence ?? 0),
      redirect: String(verdict.redirect ?? ''),
      costUsd: result.costUsd,
    };
  }

  private async runOnce(request: ModelRun): Promise<ModelResult> {
    if (request.signal?.aborted) throw new ModelRunError(LIMIT_TEXT.aborted, null, 'aborted');
    const controller = new AbortController();
    let reason: LimitReason | undefined;
    const stop = (why: LimitReason) => {
      reason ??= why;
      controller.abort();
    };
    const onAbort = () => stop('aborted');
    request.signal?.addEventListener('abort', onAbort, { once: true });
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (request.timeoutMs) timers.push(setTimeout(() => stop('timeout'), request.timeoutMs));
    let lastMessage = Date.now();
    const open = new Map<string, OpenTool>();
    let stalledOn: OpenTool | undefined;
    if (request.stallMs) {
      const every = this.options.stallCheckMs ?? Math.min(30_000, Math.max(10, request.stallMs / 4));
      const openLimit = Math.min(
        this.options.openToolStallMs ?? request.stallMs * 4,
        request.timeoutMs ?? Infinity,
      );
      timers.push(
        setInterval(() => {
          const silent = Date.now() - lastMessage;
          // A tool call that is still open holds the call for longer: the model says nothing while it runs.
          const longest = [...open.values()].sort((a, b) => a.since - b.since)[0];
          const limit = longest ? Math.max(request.stallMs!, openLimit) : request.stallMs!;
          if (silent >= limit) {
            stalledOn = longest;
            stop('stalled');
          }
        }, every),
      );
    }
    try {
      return await this.call(request, controller, () => (lastMessage = Date.now()), open);
    } catch (error) {
      if (reason) {
        const text =
          reason === 'stalled' && stalledOn
            ? `${LIMIT_TEXT.stalled}; open tool: ${stalledOn.name} (${Math.max(1, Math.round((Date.now() - stalledOn.since) / 60_000))} min)`
            : LIMIT_TEXT[reason];
        throw new ModelRunError(text, null, reason);
      }
      throw error;
    } finally {
      for (const t of timers) clearTimeout(t);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async call(
    request: ModelRun,
    controller: AbortController,
    heard: () => void,
    open: Map<string, OpenTool>,
  ): Promise<ModelResult> {
    const tools = CLAUDE_TOOL_ACCESS[request.tools];
    // Factory and agent MCP tools are allowed by name or server prefix; the step guard still screens them.
    const allowed: string[] = request.mcp
      ? [...tools, CLAUDE_DELEGATE_TOOL, ...(request.mcp.tools ?? []).map((t) => `mcp__factory__${t}`)]
      : [...tools];
    const external = (request.mcpServers ?? []).map((s) => `mcp__${s.name}__`);
    const permitted = (name: string) => allowed.includes(name) || external.some((p) => name.startsWith(p));
    const guard = request.guard;
    const sandbox = sandboxFor(request.tools, homedir(), request.sandbox);
    const options: Options = {
      model: request.model,
      effort: request.effort,
      tools,
      // No allowedTools: pre-approved tools would bypass canUseTool and the step's guard.
      // Do not load the user's or the target repository's Claude settings, hooks or plugins.
      settingSources: [],
      // settingSources: [] still lists built-in skills and slash commands (runtime baseline,
      // finding 2); a workflow step gets only what its prompt gives it.
      skills: [],
      extraArgs: { 'disable-slash-commands': null },
      persistSession: request.persistSession === true || Boolean(request.resume),
      permissionMode: 'default',
      canUseTool: async (toolName, input) => {
        if (!permitted(toolName))
          return { behavior: 'deny', message: `${toolName} is not available to this step` };
        const denial = guard?.check(toolName, input);
        return denial ? { behavior: 'deny', message: denial } : { behavior: 'allow', updatedInput: input };
      },
      systemPrompt:
        request.tools === 'none'
          ? request.systemPrompt
          : { type: 'preset', preset: 'claude_code', append: request.systemPrompt },
      env: {
        ...agentEnvironment('claude', process.env, [
          ...envNames(process.env.FACTORY_AGENT_ENV_ALLOW),
          ...(request.passEnv ?? []),
        ]),
        ...request.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: 'factory-elections/0.1.0',
        MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS),
      },
      abortController: controller,
      ...(request.maxBudgetUsd ? { maxBudgetUsd: request.maxBudgetUsd } : {}),
      ...(sandbox ? { sandbox } : {}),
      ...(request.cwd ? { cwd: request.cwd } : {}),
      ...(request.maxTurns ? { maxTurns: request.maxTurns } : {}),
      ...(request.resume ? { resume: request.resume } : {}),
      ...(request.mcp || request.mcpServers?.length
        ? {
            mcpServers: {
              ...Object.fromEntries(
                (request.mcpServers ?? []).map((s) => [
                  s.name,
                  { type: 'http' as const, url: s.url, ...(s.headers ? { headers: s.headers } : {}) },
                ]),
              ),
              ...(request.mcp
                ? (JSON.parse(claudeMcpConfig(request.mcp)) as Pick<Options, 'mcpServers'>).mcpServers
                : {}),
            },
          }
        : {}),
      ...(request.outputSchema
        ? { outputFormat: { type: 'json_schema', schema: request.outputSchema } }
        : {}),
    };

    // Notes for the agent (context warnings) ride on the next tool result, through SDK hooks.
    let note: string | undefined;
    const takeNote = () => {
      const n = note;
      note = undefined;
      return n;
    };
    const loop = request.loopGuard
      ? new LoopGuard({
          judge: async (evidence) => {
            const started = Date.now();
            const verdict = await this.judge(evidence, request.signal);
            request.onEvent?.({
              type: 'judge',
              stuck: verdict.stuck,
              confidence: verdict.confidence,
              costUsd: verdict.costUsd,
              startedAt: new Date(started).toISOString(),
              durationMs: Date.now() - started,
            });
            return verdict;
          },
          onStuck: (line) => this.options.onProgress?.(`  · loop guard: ${line}`),
        })
      : undefined;
    let contextLevel = 0;
    const hooks: Partial<Record<'PostToolUse' | 'PostToolUseFailure', HookCallbackMatcher[]>> = {};
    if (request.context || loop) {
      hooks.PostToolUse = [
        {
          hooks: [
            async () => {
              const n = takeNote();
              return n ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: n } } : {};
            },
          ],
        },
      ];
      hooks.PostToolUseFailure = [
        {
          hooks: [
            async (input) => {
              const failure = input as PostToolUseFailureHookInput;
              const redirect = loop
                ? await loop.failure(failure.tool_name, describeInput(failure.tool_input), failure.error)
                : undefined;
              if (redirect) this.options.onProgress?.('  · loop guard: redirected the agent');
              const n = [redirect, takeNote()].filter(Boolean).join('\n\n');
              return n
                ? { hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext: n } }
                : {};
            },
          ],
        },
      ];
      options.hooks = hooks;
    }

    let result: SDKResultMessage | undefined;
    const activity: CallActivity = { assistantMessages: 0, toolCalls: 0 };
    try {
      for await (const message of (this.options.query ?? query)({ prompt: request.prompt, options })) {
        heard();
        if (message.type === 'assistant') {
          activity.assistantMessages++;
          for (const block of message.message.content)
            if (block.type === 'tool_use') {
              activity.toolCalls++;
              if (block.name !== 'StructuredOutput')
                open.set(block.id, { name: block.name, since: Date.now() });
            }
        } else if (message.type === 'user') {
          // A tool_result closes its call, also for subagents (parent_tool_use_id is set).
          const content = (message.message as { content?: unknown }).content;
          if (Array.isArray(content))
            for (const block of content as { type?: string; tool_use_id?: string }[])
              if (block?.type === 'tool_result' && block.tool_use_id) open.delete(block.tool_use_id);
        }
        if (request.context && message.type === 'assistant')
          for (const event of claudeMessageEvents(message as unknown as Record<string, unknown>))
            if (event.type === 'context') {
              const status = contextStatus(event.tokens, request.context.limit);
              const level = status.over ? 2 : status.warn ? 1 : 0;
              if (level > contextLevel) {
                contextLevel = level;
                note = contextWarning(status);
                request.context.onStatus?.(status);
              }
            }
        if (request.onEvent)
          for (const event of claudeMessageEvents(message as unknown as Record<string, unknown>))
            request.onEvent(event);
        if (message.type === 'result') result = message;
        else if (message.type === 'assistant' && this.options.onProgress) {
          for (const block of message.message.content) {
            if (block.type === 'tool_use' && block.name !== 'StructuredOutput')
              this.options.onProgress(describeToolUse(block.name, block.input));
          }
        }
      }
    } catch (error) {
      const message = `model run failed: ${(error as Error).message}`;
      throw new ModelRunError(message, null, modelFailureKind(message), activity);
    }
    if (!result) {
      const message = 'model run ended without a result';
      throw new ModelRunError(message, null, modelFailureKind(message), activity);
    }
    const extra = loop?.spentUsd ?? 0;
    if (extra && typeof result.total_cost_usd === 'number') result.total_cost_usd += extra;
    if (result.subtype !== 'success' || result.is_error) {
      const detail = result.subtype === 'success' ? result.result : result.errors.join('; ');
      const message = `model run failed (${result.subtype}): ${detail || 'no detail'}`;
      throw new ModelRunError(
        message,
        result.total_cost_usd ?? null,
        result.subtype === 'error_max_budget_usd' ? 'budget' : modelFailureKind(message),
        activity,
      );
    }
    return {
      text: result.result,
      structured: result.structured_output,
      costUsd: result.total_cost_usd ?? null,
      ...(result.session_id ? { sessionId: result.session_id } : {}),
      // Test doubles and older CLIs may leave usage out.
      ...((result.usage as typeof result.usage | undefined)
        ? {
            usage: {
              // Anthropic counts cache reads and writes apart from input_tokens; the shared shape includes them.
              inputTokens:
                result.usage.input_tokens +
                (result.usage.cache_read_input_tokens ?? 0) +
                (result.usage.cache_creation_input_tokens ?? 0),
              outputTokens: result.usage.output_tokens,
              cachedInputTokens: result.usage.cache_read_input_tokens ?? 0,
              cacheWriteInputTokens: result.usage.cache_creation_input_tokens ?? 0,
            },
          }
        : {}),
    };
  }
}

function describeInput(input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>;
  return String(record.command ?? record.file_path ?? record.path ?? record.pattern ?? '').slice(0, 300);
}

function describeToolUse(name: string, input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>;
  const detail = record.command ?? record.file_path ?? record.pattern ?? record.path ?? '';
  return `  · ${name} ${String(detail).split('\n')[0]?.slice(0, 100) ?? ''}`.trimEnd();
}
