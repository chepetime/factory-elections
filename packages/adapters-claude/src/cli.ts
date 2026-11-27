// Claude Code's headless CLI (`claude -p --output-format stream-json`) as an AgentCli.
import type { AgentCli, AgentEvent, HeadlessTurn } from '@factory/core';
import { turnSandbox } from './sandbox.ts';

/** The `delegate` tool, as Claude Code names a tool on the backend's MCP server. */
export const CLAUDE_DELEGATE_TOOL = 'mcp__factory__delegate';

/** How long Claude Code waits for an MCP tool call: a child task can run for a long time. */
export const MCP_TOOL_TIMEOUT_MS = 2 * 60 * 60_000;

export function claudeMcpConfig(mcp: NonNullable<HeadlessTurn['mcp']>): string {
  return JSON.stringify({
    mcpServers: {
      factory: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } },
    },
  });
}

function sandboxArgs(turn: HeadlessTurn): string[] {
  const sandbox = turnSandbox(turn);
  return sandbox ? ['--settings', JSON.stringify({ sandbox })] : [];
}

export const claudeCli: AgentCli = {
  id: 'claude',
  command: 'claude',
  args: (turn) => [
    '-p',
    // Same runner as the `elections review` CLI; deny rules still apply in this mode.
    '--dangerously-skip-permissions',
    // Load no settings: not the user's skills, plugins, hooks or MCP servers (claude.ai connectors
    // included), and not the repository's .claude/settings.json, which is the pull request's own and
    // so untrusted (its hooks would run code at session start). The review skill is in the system
    // prompt. Measured on change-elections with the project source then loaded: 111 tools / 46
    // skills / 45 MCP servers became 25 / 0 / 0, and each model call carried ~10k fewer input tokens.
    // The empty value is what the SDK sends for `settingSources: []`.
    '--setting-sources=',
    // The OS sandbox, as inline settings: the SDK passes its `sandbox` option the same way.
    ...sandboxArgs(turn),
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--model',
    turn.model ?? 'claude-opus-5-5',
    '--output-format',
    'stream-json',
    '--verbose',
    '--append-system-prompt-file',
    turn.systemPromptFile,
    ...(turn.budgetUsd ? ['--max-budget-usd', String(turn.budgetUsd)] : []),
    // Tools left out after going unused (memory's tool pruning).
    ...(turn.tools ? ['--tools', turn.tools.join(',')] : []),
    // MCP tools need an explicit allow even with --dangerously-skip-permissions.
    ...(turn.mcp ? ['--mcp-config', claudeMcpConfig(turn.mcp), '--allowedTools', CLAUDE_DELEGATE_TOOL] : []),
    ...(turn.deny.length ? ['--disallowedTools', ...turn.deny] : []),
    ...(turn.resume ? ['--resume', turn.resume] : []),
    // Ends the variadic tool list, so the message is never read as a tool rule.
    '--',
    turn.message,
  ],
  env: () => ({ MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) }),
  parse: parseClaudeLine,
};

/** Events in one line of Claude Code stream-json (the SDK emits the same message shapes). */
export function parseClaudeLine(line: string): AgentEvent[] {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!e || typeof e !== 'object') return [];
  return claudeMessageEvents(e);
}

export function claudeMessageEvents(e: Record<string, unknown>): AgentEvent[] {
  const events: AgentEvent[] = [];
  const sub = Boolean(e.parent_tool_use_id);
  const parent = typeof e.parent_tool_use_id === 'string' ? { parentCallId: e.parent_tool_use_id } : {};
  if (e.type === 'system' && e.subtype === 'init' && typeof e.session_id === 'string')
    events.push({ type: 'session', id: e.session_id });
  if (e.type === 'user') {
    const content = (e.message as { content?: unknown } | undefined)?.content;
    if (Array.isArray(content))
      for (const part of content as Record<string, unknown>[])
        if (part.type === 'tool_result')
          events.push({
            type: 'tool-result',
            ok: part.is_error !== true,
            text: resultText(part.content),
            ...(sub ? { sub } : {}),
            ...(typeof part.tool_use_id === 'string' ? { callId: part.tool_use_id } : {}),
            ...parent,
          });
  }
  if (e.type === 'assistant') {
    // Each request's usage says how much the model read: the context size at that point.
    const usage = (e.message as { usage?: Record<string, unknown> } | undefined)?.usage;
    if (!sub && usage && typeof usage.input_tokens === 'number')
      events.push({
        type: 'context',
        tokens:
          usage.input_tokens +
          Number(usage.cache_read_input_tokens ?? 0) +
          Number(usage.cache_creation_input_tokens ?? 0),
      });
    const content = (e.message as { content?: unknown } | undefined)?.content;
    if (Array.isArray(content))
      for (const part of content as Record<string, unknown>[]) {
        if (part.type === 'text' && typeof part.text === 'string' && part.text.trim())
          events.push({ type: 'text', text: part.text.trim(), ...(sub ? { sub } : {}) });
        if (part.type === 'tool_use' && typeof part.name === 'string')
          events.push({
            type: 'tool',
            name: part.name,
            input: (part.input as Record<string, unknown>) ?? {},
            ...(sub ? { sub } : {}),
            ...(typeof part.id === 'string' ? { callId: part.id } : {}),
            ...parent,
          });
      }
  } else if (e.type === 'result') {
    const usage = e.usage as Record<string, unknown> | undefined;
    events.push({
      type: 'result',
      ok: e.is_error !== true && e.subtype === 'success',
      text:
        typeof e.result === 'string'
          ? e.result
          : Array.isArray(e.errors)
            ? e.errors.join('; ')
            : String(e.subtype ?? ''),
      ...(typeof e.total_cost_usd === 'number' ? { costUsd: e.total_cost_usd } : {}),
      ...(typeof e.duration_ms === 'number' ? { durationMs: e.duration_ms } : {}),
      ...(typeof e.session_id === 'string' ? { sessionId: e.session_id } : {}),
      ...(usage && typeof usage.input_tokens === 'number'
        ? {
            usage: {
              // Anthropic counts cache reads and writes apart from input_tokens; the shared shape includes them.
              inputTokens:
                usage.input_tokens +
                Number(usage.cache_read_input_tokens ?? 0) +
                Number(usage.cache_creation_input_tokens ?? 0),
              outputTokens: Number(usage.output_tokens ?? 0),
              cachedInputTokens: Number(usage.cache_read_input_tokens ?? 0),
              cacheWriteInputTokens: Number(usage.cache_creation_input_tokens ?? 0),
            },
          }
        : {}),
    });
  }
  return events;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, 2000);
  if (Array.isArray(content))
    return content
      .map((c) =>
        c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string'
          ? (c as { text: string }).text
          : '',
      )
      .join('\n')
      .slice(0, 2000);
  return '';
}
