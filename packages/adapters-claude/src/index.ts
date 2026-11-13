// Model runner backed by the Claude Agent SDK. Authentication is the machine's own Claude sign-in
// (or ANTHROPIC_API_KEY); this adapter stores no credentials.
import { query, type Options, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ModelResult, ModelRun, ModelRunner, ToolAccess } from '@factory/core';

const TOOLS: Record<ToolAccess, string[]> = {
  none: [],
  'read-only': ['Read', 'Grep', 'Glob'],
  edit: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
};

export class ModelRunError extends Error {}

export interface ClaudeRunnerOptions {
  /** Receives one short line per assistant tool call, for progress output. */
  onProgress?: (line: string) => void;
}

export class ClaudeAgentRunner implements ModelRunner {
  readonly options: ClaudeRunnerOptions;
  constructor(options: ClaudeRunnerOptions = {}) {
    this.options = options;
  }

  async run(request: ModelRun): Promise<ModelResult> {
    const tools = TOOLS[request.tools];
    const guard = request.guard;
    const options: Options = {
      model: request.model,
      effort: request.effort,
      tools,
      allowedTools: request.tools === 'edit' ? [] : tools,
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
      ...(request.cwd ? { cwd: request.cwd } : {}),
      ...(request.maxTurns ? { maxTurns: request.maxTurns } : {}),
      ...(request.outputSchema
        ? { outputFormat: { type: 'json_schema', schema: request.outputSchema } }
        : {}),
    };

    let result: SDKResultMessage | undefined;
    try {
      for await (const message of query({ prompt: request.prompt, options })) {
        if (message.type === 'result') result = message;
        else if (message.type === 'assistant' && this.options.onProgress) {
          for (const block of message.message.content) {
            if (block.type === 'tool_use') this.options.onProgress(describeToolUse(block.name, block.input));
          }
        }
      }
    } catch (error) {
      throw new ModelRunError(`model run failed: ${(error as Error).message}`);
    }
    if (!result) throw new ModelRunError('model run ended without a result');
    if (result.subtype !== 'success' || result.is_error) {
      const detail = result.subtype === 'success' ? result.result : result.errors.join('; ');
      throw new ModelRunError(`model run failed (${result.subtype}): ${detail || 'no detail'}`);
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
