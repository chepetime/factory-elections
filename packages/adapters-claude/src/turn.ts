// One chat turn (PR review, follow-up) on the Agent SDK, in this process. It takes the same
// HeadlessTurn as the detached `claude -p` CLI and sets the same flags, so a review turn behaves
// the same on either path; the difference is that the backend owns it: abort, budget and the
// result come back here instead of through a PID and an exit file.
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { HeadlessTurn } from '@factory/core';
import { claudeMcpConfig, MCP_TOOL_TIMEOUT_MS } from './cli.ts';
import { turnSandbox } from './sandbox.ts';

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
  /** `budget` when the turn stopped at its dollar limit; absent for any other failure. */
  kind?: 'budget';
  /** The turn ended because the signal aborted. */
  aborted: boolean;
  /** The SDK sent a result message; false when the stream threw or ended without one. */
  reported: boolean;
}

/**
 * The deny rule that refuses a tool call, if any. Rules are `Tool` or `Bash(prefix:*)`; a Bash
 * command is checked part by part (split on `&&`, `||`, `;`, `|` and new lines), so a refused
 * command cannot hide behind another.
 */
export function deniedBy(
  deny: readonly string[],
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  for (const rule of deny) {
    const m = /^(\w+)\((.*)\)$/.exec(rule);
    if (!m) {
      if (rule === toolName) return rule;
      continue;
    }
    if (m[1] !== toolName) continue;
    const pattern = m[2]!.replace(/:\*$/, '').trim();
    if (toolName !== 'Bash') continue;
    const command = String(input.command ?? '');
    const parts = command
      .split(/&&|\|\||;|\||\n/)
      .map((p) => p.trim().replace(/^(sudo|env\s+\S+=\S+)\s+/, ''));
    if (parts.some((p) => p === pattern || p.startsWith(`${pattern} `))) return rule;
  }
  return undefined;
}

/** SDK options equal to `claudeCli.args` for the same turn (see cli.ts for the reasons). */
export function claudeTurnOptions(
  request: Omit<ClaudeTurnRequest, 'onLine' | 'signal'>,
  abortController: AbortController,
): Options {
  const { turn } = request;
  const sandbox = turnSandbox(turn);
  return {
    model: turn.model ?? CLAUDE_TURN_MODEL,
    cwd: request.cwd,
    // The CLI path skips permissions (--dangerously-skip-permissions). On the SDK, bypass mode did not
    // take effect (turns ran in `default` and every write was refused), so the turn runs in `default`
    // and this guard answers each permission check: allow, except what a deny rule names. The CLI
    // also applies `disallowedTools` before asking, so the deny rules hold twice.
    permissionMode: 'default',
    canUseTool: async (toolName, input) => {
      const denied = deniedBy(turn.deny, toolName, input);
      return denied
        ? { behavior: 'deny', message: `${toolName} is not allowed in this turn (${denied}).` }
        : { behavior: 'allow', updatedInput: input };
    },
    // --setting-sources= --strict-mcp-config --disable-slash-commands. No settings source is loaded:
    // the repository's .claude/settings.json is the pull request's own, so it is untrusted (its hooks
    // would run code at session start). The review skill is in the system prompt.
    settingSources: [],
    strictMcpConfig: true,
    skills: [],
    extraArgs: { 'disable-slash-commands': null },
    systemPrompt: { type: 'preset', preset: 'claude_code', append: request.systemPrompt },
    persistSession: true,
    env: { ...request.env, MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) },
    abortController,
    ...(sandbox ? { sandbox } : {}),
    ...(turn.budgetUsd ? { maxBudgetUsd: turn.budgetUsd } : {}),
    ...(turn.tools ? { tools: [...turn.tools] } : {}),
    ...(turn.mcp
      ? {
          // No allowedTools: the CLI needs --allowedTools for the delegate tool because it skips
          // permissions, but here a bare allow entry would approve it before canUseTool runs, so a
          // deny rule naming it would never apply. The guard allows it like any other tool.
          mcpServers: (JSON.parse(claudeMcpConfig(turn.mcp)) as Pick<Options, 'mcpServers'>).mcpServers,
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
          ...(message.subtype === 'error_max_budget_usd' ? { kind: 'budget' as const } : {}),
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
