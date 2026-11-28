import { rm } from 'node:fs/promises';
import { piHome, piSessionArgs } from './pi-home.ts';
import { run, type ProcessResult } from '@factory/adapters-process';
import {
  agentEnvironment,
  parseModelRef,
  ProviderRefused,
  type ModelResult,
  type ModelRun,
  type Usage,
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
    request.mcpServers?.length ||
    request.outputSchema ||
    request.maxTokens !== undefined
  )
    throw new ProviderRefused(
      'Pi requires Factory-managed tools and does not support structured output or token caps.',
    );
  return model;
}

export async function runPi(request: ModelRun): Promise<ModelResult> {
  const model = modelFor(request);
  const args = await piSessionArgs(request);
  const home = await piHome(request);
  const turn = new PiTurn(request);
  const signals = request.signal ? [turn.stop.signal, request.signal] : [turn.stop.signal];
  try {
    const output = await run(
      'pi',
      [
        '--offline',
        '--no-approve',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-context-files',
        '--no-themes',
        ...(request.mcp ? ['--no-builtin-tools', '-e', 'builtin:mcp'] : ['--no-mcp', '--no-tools']),
        ...args,
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
        env: {
          ...agentEnvironment('pi', process.env),
          PI_CODING_AGENT_DIR: home,
          FACTORY_PI_TOKEN: request.mcp?.token,
        },
        group: true,
        timeoutMs: request.timeoutMs,
        stallMs: request.stallMs,
        signal: AbortSignal.any(signals),
        captureLimit: 64 * 1024,
        onStdout: (chunk) => turn.append(chunk),
      },
    );
    return turn.result(output);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

class PiTurn {
  readonly stop = new AbortController();
  private pending = '';
  private message?: PiMessage;
  private sessionId?: string;
  private spend = 0;
  private readonly usage: Required<Usage> = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
  };
  private usageKnown = true;
  private turns = 0;
  private failure?: { kind: string; message: string };

  private readonly request: ModelRun;

  constructor(request: ModelRun) {
    this.request = request;
  }

  append(chunk: string) {
    const lines = (this.pending + chunk).split('\n');
    this.pending = lines.pop() ?? '';
    for (const line of lines) this.take(line);
  }

  private take(line: string) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === 'session' && this.request.persistSession) {
      this.sessionId = event.id;
      this.request.onEvent?.({ type: 'session', id: event.id });
    }
    this.toolEvent(event);
    if (event.type === 'message_end' && event.message?.role === 'assistant') this.count(event.message);
    if (event.type === 'agent_end' && !event.willRetry)
      this.message = event.messages?.findLast((item: PiMessage) => item.role === 'assistant');
  }

  private toolEvent(event: {
    type: string;
    toolCallId?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    isError?: boolean;
    result?: { content?: { type: string; text?: string }[] };
  }) {
    if (!event.toolCallId) return;
    if (event.type === 'tool_execution_start' && event.toolName)
      this.request.onEvent?.({
        type: 'tool',
        callId: event.toolCallId,
        name: event.toolName,
        input: event.args ?? {},
      });
    if (event.type === 'tool_execution_end')
      this.request.onEvent?.({
        type: 'tool-result',
        callId: event.toolCallId,
        ok: !event.isError,
        text:
          event.result?.content
            ?.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
            .join('\n') ?? '',
      });
  }

  private count(message: PiMessage) {
    this.turns++;
    const usage = message.usage;
    if (usage) {
      this.usage.inputTokens += usage.input + usage.cacheRead + usage.cacheWrite;
      this.usage.outputTokens += usage.output;
      this.usage.cachedInputTokens += usage.cacheRead;
      this.usage.cacheWriteInputTokens += usage.cacheWrite;
    }
    const cost = message.usage?.cost?.total;
    if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) this.spend += cost;
    else this.usageKnown = false;
    const budget = this.request.maxBudgetUsd;
    if (budget !== undefined && (!this.usageKnown || this.spend >= budget))
      this.fail('budget', 'Pi reached its budget or stopped reporting cost.');
    if (
      this.request.maxTurns !== undefined &&
      this.turns >= this.request.maxTurns &&
      message.stopReason === 'toolUse'
    )
      this.fail('error', 'Pi reached the requested turn limit.');
  }

  private fail(kind: string, message: string) {
    this.failure ??= { kind, message };
    this.stop.abort();
  }

  result(output: ProcessResult): ModelResult {
    if (this.pending) this.take(this.pending);
    const costUsd = this.usageKnown ? this.spend : null;
    if (this.failure)
      throw Object.assign(new Error(this.failure.message), {
        kind: this.failure.kind,
        costUsd:
          this.failure.kind === 'budget' ? Math.max(costUsd ?? 0, this.request.maxBudgetUsd ?? 0) : costUsd,
      });
    try {
      return {
        text: piText(output, this.message, this.request.onEvent),
        costUsd,
        usage: this.usage,
        ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      };
    } catch (error) {
      throw Object.assign(error as Error, { costUsd });
    }
  }
}

function piText(output: ProcessResult, message: PiMessage | undefined, onEvent: ModelRun['onEvent']): string {
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
  return text;
}
