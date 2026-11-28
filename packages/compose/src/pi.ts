import { run, type ProcessResult } from '@factory/adapters-process';
import {
  agentEnvironment,
  parseModelRef,
  ProviderRefused,
  type ModelResult,
  type ModelRun,
} from '@factory/core';

type PiMessage = {
  role: string;
  content?: { type: string; text?: string }[];
  stopReason?: string;
  errorMessage?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost?: { total: number } };
};

function modelFor(request: ModelRun): string {
  const { provider, model } = parseModelRef(request.model);
  if (
    provider !== 'pi' ||
    !model ||
    request.tools !== 'none' ||
    request.guard ||
    request.mcp ||
    request.mcpServers?.length ||
    request.resume ||
    request.persistSession ||
    request.outputSchema ||
    request.maxBudgetUsd !== undefined ||
    request.maxTokens !== undefined
  )
    throw new ProviderRefused(
      'Pi currently supports only unguarded, non-persistent model calls with tools disabled and no budget limit.',
    );
  return model;
}

export async function runPi(request: ModelRun): Promise<ModelResult> {
  const model = modelFor(request);
  let pending = '';
  let message: PiMessage | undefined;
  function take(line: string) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'agent_end' && !event.willRetry)
        message = event.messages?.findLast((item: PiMessage) => item.role === 'assistant');
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  const output = await run(
    'pi',
    [
      '--offline',
      '--no-approve',
      '--no-extensions',
      '--no-mcp',
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
      '--no-tools',
      '--no-session',
      '--model',
      model,
      '--thinking',
      request.effort,
      '--system-prompt',
      request.systemPrompt,
      '--mode',
      'json',
      '--print',
      '--',
      request.prompt,
    ],
    {
      cwd: request.cwd,
      env: agentEnvironment('pi', process.env, request.passEnv),
      group: true,
      timeoutMs: request.timeoutMs,
      stallMs: request.stallMs,
      signal: request.signal,
      captureLimit: 64 * 1024,
      onStdout(chunk) {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) take(line);
      },
    },
  );
  if (pending) take(pending);
  return piResult(output, message, request.onEvent);
}

function piResult(
  output: ProcessResult,
  message: PiMessage | undefined,
  onEvent: ModelRun['onEvent'],
): ModelResult {
  if (output.stopped)
    throw Object.assign(new Error(`Pi call stopped: ${output.stopped}`), { kind: output.stopped });
  if (output.code !== 0 || !message || message.stopReason === 'error' || message.stopReason === 'aborted')
    throw new Error(message?.errorMessage || output.stderr.trim().slice(-1000) || 'Pi returned no result.');
  const text =
    message.content
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n') ?? '';
  if (text) onEvent?.({ type: 'text', text });
  return { text, ...piUsage(message.usage) };
}

function piUsage(usage: PiMessage['usage']): Omit<ModelResult, 'text'> {
  if (!usage) return { costUsd: null };
  return {
    costUsd: usage.cost?.total ?? null,
    usage: {
      inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
      outputTokens: usage.output,
      cachedInputTokens: usage.cacheRead,
      cacheWriteInputTokens: usage.cacheWrite,
    },
  };
}
