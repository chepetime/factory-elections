// One chat turn (PR review, follow-up) on the Agent SDK, in this process. It takes the same
// HeadlessTurn as the detached `claude -p` CLI and sets the same flags, so a review turn behaves
// the same on either path; the difference is that the backend owns it: abort, budget and the
// result come back here instead of through a PID and an exit file.
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { HeadlessTurn } from '@factory/core';
import { CLAUDE_DELEGATE_TOOL, claudeMcpConfig, MCP_TOOL_TIMEOUT_MS } from './cli.ts';

/** The model a review turn uses when the turn names none, as on the CLI path. */
export const CLAUDE_TURN_MODEL = 'claude-opus-5-5';

export interface ClaudeTurnRequest {
  turn: HeadlessTurn;
  /** The text the CLI path reads from `turn.systemPromptFile`. */
  systemPrompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  /** Each SDK message as one JSON line: the same shapes as `--output-format stream-json`. */
  onLine: (line: string) => void;
}

export interface ClaudeTurnResult {
  ok: boolean;
  sessionId?: string;
  costUsd?: number;
  /** Why the turn failed, when it did. */
  error?: string;
  /** The turn ended because the signal aborted. */
  aborted: boolean;
  /** The SDK sent a result message; false when the stream threw or ended without one. */
  reported: boolean;
}

/** SDK options equal to `claudeCli.args` for the same turn (see cli.ts for the reasons). */
export function claudeTurnOptions(
  request: Omit<ClaudeTurnRequest, 'onLine' | 'signal'>,
  abortController: AbortController,
): Options {
  const { turn } = request;
  return {
    model: turn.model ?? CLAUDE_TURN_MODEL,
    cwd: request.cwd,
    // --dangerously-skip-permissions: deny rules still apply in this mode.
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // --setting-sources project --strict-mcp-config --disable-slash-commands
    settingSources: ['project'],
    strictMcpConfig: true,
    skills: [],
    extraArgs: { 'disable-slash-commands': null },
    systemPrompt: { type: 'preset', preset: 'claude_code', append: request.systemPrompt },
    persistSession: true,
    env: { ...request.env, MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) },
    abortController,
    ...(turn.budgetUsd ? { maxBudgetUsd: turn.budgetUsd } : {}),
    ...(turn.tools ? { tools: [...turn.tools] } : {}),
    ...(turn.mcp
      ? {
          mcpServers: (JSON.parse(claudeMcpConfig(turn.mcp)) as Pick<Options, 'mcpServers'>).mcpServers,
          allowedTools: [CLAUDE_DELEGATE_TOOL],
        }
      : {}),
    ...(turn.deny.length ? { disallowedTools: [...turn.deny] } : {}),
    ...(turn.resume ? { resume: turn.resume } : {}),
  };
}

/** Runs one turn to its result. It never throws for a provider failure: the result says so. */
export async function runClaudeTurn(
  request: ClaudeTurnRequest,
  sdkQuery: typeof query = query,
): Promise<ClaudeTurnResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (request.signal.aborted) controller.abort();
  else request.signal.addEventListener('abort', onAbort, { once: true });
  let sessionId: string | undefined;
  let result: ClaudeTurnResult | undefined;
  try {
    for await (const message of sdkQuery({
      prompt: request.turn.message,
      options: claudeTurnOptions(request, controller),
    })) {
      request.onLine(JSON.stringify(message));
      const m = message as { type?: string; session_id?: unknown };
      if (typeof m.session_id === 'string') sessionId ??= m.session_id;
      if (message.type === 'result') {
        const ok = message.subtype === 'success' && !message.is_error;
        result = {
          ok,
          aborted: false,
          reported: true,
          ...(sessionId ? { sessionId } : {}),
          ...(typeof message.total_cost_usd === 'number' ? { costUsd: message.total_cost_usd } : {}),
          ...(ok
            ? {}
            : {
                error:
                  message.subtype === 'success'
                    ? message.result || message.subtype
                    : message.errors.join('; ') || message.subtype,
              }),
        };
      }
    }
  } catch (error) {
    return {
      ok: false,
      aborted: controller.signal.aborted,
      reported: false,
      ...(sessionId ? { sessionId } : {}),
      error: (error as Error).message,
    };
  } finally {
    request.signal.removeEventListener('abort', onAbort);
  }
  return (
    result ?? {
      ok: false,
      aborted: controller.signal.aborted,
      reported: false,
      ...(sessionId ? { sessionId } : {}),
      error: 'the turn ended without a result',
    }
  );
}
