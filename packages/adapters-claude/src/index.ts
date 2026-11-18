// Model runner backed by the Claude Agent SDK. Authentication is the machine's own Claude sign-in
// (or ANTHROPIC_API_KEY); this adapter stores no credentials.
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  query,
  type Options,
  type SandboxSettings,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  modelFailureKind,
  type ModelFailure,
  type ModelResult,
  type ModelRun,
  type ModelRunner,
  type ToolAccess,
} from '@factory/core';

const TOOLS: Record<ToolAccess, string[]> = {
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
export function sandboxFor(tools: ToolAccess, home: string = homedir()): SandboxSettings | undefined {
  if (!TOOLS[tools].includes('Bash')) return undefined;
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: SANDBOX_ALLOWED_DOMAINS },
    filesystem: {
      allowWrite: [
        join(home, 'Library', 'pnpm'),
        join(home, 'Library', 'Caches', 'pnpm'),
        join(home, '.npm'),
        join(home, '.cache'),
      ],
    },
  };
}

export class ModelRunError extends Error {
  readonly costUsd: number | null;
  readonly kind: ModelFailure;
  constructor(
    message: string,
    costUsd: number | null = null,
    kind: ModelFailure = modelFailureKind(message),
  ) {
    super(message);
    this.costUsd = costUsd;
    this.kind = kind;
  }
}

/** Waits before each retry of a rate-limited call that had not spent anything yet. */
export const RATE_LIMIT_RETRY_MS = [30_000, 120_000];

export interface ClaudeRunnerOptions {
  /** Receives one short line per assistant tool call, for progress output. */
  onProgress?: (line: string) => void;
  /** The SDK's query function; tests pass a fake. */
  query?: typeof query;
  retryDelaysMs?: readonly number[];
  /** How often the stall check looks at the last message time. */
  stallCheckMs?: number;
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
  constructor(options: ClaudeRunnerOptions = {}) {
    this.options = options;
  }

  /**
   * One call, retried only when the provider rate-limited it before anything was spent: then the
   * model did no work, so a retry cannot repeat a side effect or pay twice.
   */
  async run(request: ModelRun): Promise<ModelResult> {
    const delays = this.options.retryDelaysMs ?? RATE_LIMIT_RETRY_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.runOnce(request);
      } catch (error) {
        const retry =
          error instanceof ModelRunError &&
          error.kind === 'rate-limited' &&
          !error.costUsd &&
          attempt < delays.length;
        if (!retry) throw error;
        this.options.onProgress?.(`  · rate limited; retrying in ${Math.round(delays[attempt]! / 1000)}s`);
        await pause(delays[attempt]!, request.signal);
      }
    }
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
    if (request.stallMs) {
      const every = this.options.stallCheckMs ?? Math.min(30_000, Math.max(10, request.stallMs / 4));
      timers.push(
        setInterval(() => {
          if (Date.now() - lastMessage >= request.stallMs!) stop('stalled');
        }, every),
      );
    }
    try {
      return await this.call(request, controller, () => (lastMessage = Date.now()));
    } catch (error) {
      if (reason) throw new ModelRunError(LIMIT_TEXT[reason], null, reason);
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
  ): Promise<ModelResult> {
    const tools = TOOLS[request.tools];
    const guard = request.guard;
    const sandbox = sandboxFor(request.tools);
    const options: Options = {
      model: request.model,
      effort: request.effort,
      tools,
      // No allowedTools: pre-approved tools would bypass canUseTool and the step's guard.
      // Do not load the user's or the target repository's Claude settings, hooks or plugins.
      settingSources: [],
      persistSession: false,
      permissionMode: 'default',
      canUseTool: async (toolName, input) => {
        if (!tools.includes(toolName))
          return { behavior: 'deny', message: `${toolName} is not available to this step` };
        const denial = guard?.check(toolName, input);
        return denial ? { behavior: 'deny', message: denial } : { behavior: 'allow', updatedInput: input };
      },
      systemPrompt:
        request.tools === 'none'
          ? request.systemPrompt
          : { type: 'preset', preset: 'claude_code', append: request.systemPrompt },
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'factory-elections/0.1.0' },
      abortController: controller,
      ...(request.maxBudgetUsd ? { maxBudgetUsd: request.maxBudgetUsd } : {}),
      ...(sandbox ? { sandbox } : {}),
      ...(request.cwd ? { cwd: request.cwd } : {}),
      ...(request.maxTurns ? { maxTurns: request.maxTurns } : {}),
      ...(request.outputSchema
        ? { outputFormat: { type: 'json_schema', schema: request.outputSchema } }
        : {}),
    };

    let result: SDKResultMessage | undefined;
    try {
      for await (const message of (this.options.query ?? query)({ prompt: request.prompt, options })) {
        heard();
        if (message.type === 'result') result = message;
        else if (message.type === 'assistant' && this.options.onProgress) {
          for (const block of message.message.content) {
            if (block.type === 'tool_use' && block.name !== 'StructuredOutput')
              this.options.onProgress(describeToolUse(block.name, block.input));
          }
        }
      }
    } catch (error) {
      throw new ModelRunError(`model run failed: ${(error as Error).message}`);
    }
    if (!result) throw new ModelRunError('model run ended without a result');
    if (result.subtype !== 'success' || result.is_error) {
      const detail = result.subtype === 'success' ? result.result : result.errors.join('; ');
      const message = `model run failed (${result.subtype}): ${detail || 'no detail'}`;
      throw new ModelRunError(
        message,
        result.total_cost_usd ?? null,
        result.subtype === 'error_max_budget_usd' ? 'budget' : modelFailureKind(message),
      );
    }
    return {
      text: result.result,
      structured: result.structured_output,
      costUsd: result.total_cost_usd ?? null,
    };
  }
}

function describeToolUse(name: string, input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>;
  const detail = record.command ?? record.file_path ?? record.pattern ?? record.path ?? '';
  return `  · ${name} ${String(detail).split('\n')[0]?.slice(0, 100) ?? ''}`.trimEnd();
}
