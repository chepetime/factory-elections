// Codex (`codex exec --json`) as an agent provider: a headless CLI for detached turns and a
// ModelRunner for workflow steps. Authentication is the machine's own Codex sign-in.
//
// Codex has no per-tool-call callback and its command rules match only a command's first words,
// so the factory relies on its OS sandbox: `read-only`, or `workspace-write` (writes only in the
// working directory, no network). It reports tokens, not dollars.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as runProcess } from '@factory/adapters-process';
import {
  modelFailureKind,
  type AgentCli,
  type AgentEvent,
  type Effort,
  type HeadlessTurn,
  type McpEndpoint,
  type ModelFailure,
  type ModelResult,
  type ModelRun,
  type ModelRunner,
  type ToolAccess,
} from '@factory/core';

/** The env var that carries the `delegate` token to Codex's MCP client. */
export const CODEX_TOKEN_ENV = 'FACTORY_DELEGATE_TOKEN';

const EFFORT: Record<Effort, string> = { low: 'low', medium: 'medium', high: 'high', max: 'xhigh' };

/** A TOML basic string. JSON string escapes are valid TOML escapes. */
const toml = (value: string) => JSON.stringify(value);

type Schema = Record<string, unknown>;

/**
 * OpenAI's structured output needs every object closed and every property required. Optional
 * properties become required-but-nullable here; `dropOptionalNulls` removes those nulls again.
 */
export function strictSchema(schema: Schema): Schema {
  const out: Schema = { ...schema };
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    const required = new Set((out.required as string[] | undefined) ?? []);
    const properties: Schema = {};
    for (const [key, value] of Object.entries(out.properties as Record<string, Schema>)) {
      const strict = strictSchema(value);
      properties[key] = required.has(key) ? strict : { anyOf: [strict, { type: 'null' }] };
    }
    out.properties = properties;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  if (out.items && typeof out.items === 'object') out.items = strictSchema(out.items as Schema);
  return out;
}

export function dropOptionalNulls(value: unknown, schema: Schema): unknown {
  if (Array.isArray(value) && schema.items)
    return value.map((v) => dropOptionalNulls(v, schema.items as Schema));
  if (!value || typeof value !== 'object' || !schema.properties) return value;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const inner = (schema.properties as Record<string, Schema>)[key];
    if (v === null && !required.has(key)) continue;
    out[key] = inner ? dropOptionalNulls(v, inner) : v;
  }
  return out;
}

export function sandboxFor(tools: ToolAccess): 'read-only' | 'workspace-write' {
  return tools === 'edit' ? 'workspace-write' : 'read-only';
}

function mcpArgs(mcp: McpEndpoint | undefined): string[] {
  if (!mcp) return [];
  return [
    '-c',
    `mcp_servers.factory.url=${toml(mcp.url)}`,
    '-c',
    `mcp_servers.factory.bearer_token_env_var=${toml(CODEX_TOKEN_ENV)}`,
    // A child task can run for a long time.
    '-c',
    'mcp_servers.factory.tool_timeout_sec=7200',
    // Exec mode cannot ask, so an MCP call that needs approval is denied: approve the factory's tools.
    '-c',
    'mcp_servers.factory.default_tools_approval_mode="approve"',
  ];
}

interface ExecOptions {
  model?: string;
  effort?: Effort;
  sandbox: 'read-only' | 'workspace-write';
  instructions?: string;
  schemaFile?: string;
  cwd?: string;
  mcp?: McpEndpoint;
  resume?: string;
  prompt: string;
}

/** `codex exec` arguments. The user's config.toml is not loaded, like Claude's settingSources: []. */
export function execArgs(o: ExecOptions): string[] {
  return [
    'exec',
    '--json',
    '--ignore-user-config',
    '--skip-git-repo-check',
    '-s',
    o.sandbox,
    '-c',
    'approval_policy="never"',
    // ChatGPT connectors and browser or computer control are not part of a factory turn.
    '--disable',
    'apps',
    '--disable',
    'browser_use',
    '--disable',
    'computer_use',
    ...(o.model ? ['-m', o.model] : []),
    ...(o.effort ? ['-c', `model_reasoning_effort=${toml(EFFORT[o.effort])}`] : []),
    ...(o.instructions ? ['-c', `developer_instructions=${toml(o.instructions)}`] : []),
    ...(o.schemaFile ? ['--output-schema', o.schemaFile] : []),
    ...(o.cwd ? ['-C', o.cwd] : []),
    ...mcpArgs(o.mcp),
    ...(o.resume ? ['resume', o.resume] : []),
    '--',
    o.prompt,
  ];
}

/**
 * Detached turns for chats. Codex has no deny rules that hold for wrapped commands, so a turn runs
 * in `workspace-write`: it can change only the working directory and has no network.
 */
export const codexCli: AgentCli = {
  id: 'codex',
  command: 'codex',
  args: (turn: HeadlessTurn, extra) =>
    execArgs({
      model: turn.model,
      sandbox: 'workspace-write',
      instructions: extra.systemPrompt,
      mcp: turn.mcp,
      resume: turn.resume,
      prompt: turn.message,
    }),
  env: (turn): Record<string, string> => (turn.mcp ? { [CODEX_TOKEN_ENV]: turn.mcp.token } : {}),
  parse: parseCodexLine,
};

function itemTool(item: Record<string, unknown>): AgentEvent | undefined {
  switch (item.type) {
    case 'command_execution':
      return { type: 'tool', name: 'Bash', input: { command: String(item.command ?? '') } };
    case 'file_change': {
      const changes = Array.isArray(item.changes) ? (item.changes as { path?: unknown }[]) : [];
      return {
        type: 'tool',
        name: 'Edit',
        input: { file_path: changes.map((c) => String(c.path)).join(', ') },
      };
    }
    case 'mcp_tool_call':
      return {
        type: 'tool',
        name: `mcp__${String(item.server ?? '')}__${String(item.tool ?? '')}`,
        input: (item.arguments as Record<string, unknown>) ?? {},
      };
    case 'web_search':
      return { type: 'tool', name: 'WebSearch', input: { pattern: String(item.query ?? '') } };
    default:
      return undefined;
  }
}

/** Events in one line of `codex exec --json` output. */
export function parseCodexLine(line: string): AgentEvent[] {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!e || typeof e !== 'object') return [];
  const item = (e.item ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case 'thread.started':
      return typeof e.thread_id === 'string' ? [{ type: 'session', id: e.thread_id }] : [];
    case 'item.started': {
      // Commands and MCP calls show when they start; file changes arrive only completed.
      const tool =
        item.type === 'command_execution' || item.type === 'mcp_tool_call' ? itemTool(item) : undefined;
      return tool ? [tool] : [];
    }
    case 'item.completed': {
      if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim())
        return [{ type: 'text', text: item.text.trim() }];
      if (item.type === 'command_execution')
        return [
          {
            type: 'tool-result',
            ok: item.exit_code === 0,
            text: String(item.aggregated_output ?? '').slice(-2000),
          },
        ];
      if (item.type === 'mcp_tool_call')
        return [
          {
            type: 'tool-result',
            ok: item.status !== 'failed',
            text: JSON.stringify(item.error ?? item.result ?? '').slice(0, 2000),
          },
        ];
      const tool = item.type === 'file_change' || item.type === 'web_search' ? itemTool(item) : undefined;
      return tool ? [tool] : [];
    }
    case 'turn.completed': {
      const u = (e.usage ?? {}) as Record<string, unknown>;
      return [
        {
          type: 'result',
          ok: true,
          text: '',
          usage: {
            inputTokens: Number(u.input_tokens ?? 0),
            outputTokens: Number(u.output_tokens ?? 0),
            cachedInputTokens: Number(u.cached_input_tokens ?? 0),
          },
        },
      ];
    }
    case 'turn.failed': {
      const error = (e.error ?? {}) as { message?: unknown };
      return [{ type: 'result', ok: false, text: String(error.message ?? 'Codex turn failed') }];
    }
    case 'error':
      return [{ type: 'result', ok: false, text: String(e.message ?? 'Codex error') }];
    default:
      return [];
  }
}

export class CodexRunError extends Error {
  readonly costUsd = null;
  readonly kind: ModelFailure;
  constructor(message: string, kind: ModelFailure = modelFailureKind(message)) {
    super(message);
    this.kind = kind;
  }
}

export interface CodexRunnerOptions {
  command?: string;
  onProgress?: (line: string) => void;
  stallCheckMs?: number;
}

export class CodexRunner implements ModelRunner {
  readonly options: CodexRunnerOptions;
  constructor(options: CodexRunnerOptions = {}) {
    this.options = options;
  }

  async run(request: ModelRun): Promise<ModelResult> {
    if (request.guard)
      throw new CodexRunError('codex cannot screen each tool call, so it cannot run a guarded step', 'error');
    if (request.signal?.aborted) throw new CodexRunError('model run stopped: aborted', 'aborted');
    const dir = request.outputSchema ? await mkdtemp(join(tmpdir(), 'factory-codex-')) : undefined;
    try {
      const schemaFile = dir && join(dir, 'schema.json');
      if (schemaFile) await writeFile(schemaFile, JSON.stringify(strictSchema(request.outputSchema!)));
      const model = request.model === 'codex' ? undefined : request.model.replace(/^codex:/, '');
      const args = execArgs({
        model,
        effort: request.effort,
        sandbox: sandboxFor(request.tools),
        instructions: request.systemPrompt,
        schemaFile,
        cwd: request.cwd,
        mcp: request.mcp,
        resume: request.resume,
        prompt: request.prompt,
      });
      return await this.exec(args, request);
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  }

  private async exec(args: string[], request: ModelRun): Promise<ModelResult> {
    const controller = new AbortController();
    let stalled = false;
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });
    let last = Date.now();
    const stall =
      request.stallMs &&
      setInterval(
        () => {
          if (Date.now() - last >= request.stallMs!) {
            stalled = true;
            controller.abort();
          }
        },
        this.options.stallCheckMs ?? Math.min(30_000, Math.max(10, request.stallMs / 4)),
      );
    let pending = '';
    let sessionId: string | undefined;
    let text = '';
    let result: Extract<AgentEvent, { type: 'result' }> | undefined;
    const take = (line: string) => {
      for (const event of parseCodexLine(line)) {
        request.onEvent?.(event);
        if (event.type === 'session') sessionId = event.id;
        else if (event.type === 'text') text = event.text;
        else if (event.type === 'result') result = event;
        else if (event.type === 'tool')
          this.options.onProgress?.(`  · ${event.name} ${describe(event.input)}`);
      }
    };
    try {
      const out = await runProcess(this.options.command ?? 'codex', args, {
        cwd: request.cwd,
        env: {
          ...process.env,
          ...request.env,
          ...(request.mcp ? { [CODEX_TOKEN_ENV]: request.mcp.token } : {}),
        },
        signal: controller.signal,
        group: true,
        captureLimit: 64 * 1024,
        ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
        onOutput: (chunk) => {
          last = Date.now();
          pending += chunk;
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) take(line);
        },
      });
      if (pending) take(pending);
      if (out.stopped === 'timeout')
        throw new CodexRunError('model run stopped: it reached its time limit', 'timeout');
      if (out.stopped === 'aborted')
        throw stalled
          ? new CodexRunError(
              'model run stopped: no message from the model within the stall limit',
              'stalled',
            )
          : new CodexRunError(
              'model run stopped: the backend is shutting down or the run was cancelled',
              'aborted',
            );
      if (!result || !result.ok || out.code !== 0) {
        const detail =
          result?.text || out.stderr.trim().split('\n').slice(-5).join('\n') || `exit ${out.code}`;
        throw new CodexRunError(`model run failed (codex): ${detail}`);
      }
      let structured: unknown;
      if (request.outputSchema) {
        try {
          structured = dropOptionalNulls(JSON.parse(text), request.outputSchema);
        } catch {
          throw new CodexRunError('model run failed (codex): the final answer is not the requested JSON');
        }
      }
      return {
        text,
        ...(structured !== undefined ? { structured } : {}),
        costUsd: null,
        ...(sessionId ? { sessionId } : {}),
        ...(result.usage ? { usage: result.usage } : {}),
      };
    } finally {
      if (stall) clearInterval(stall);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function describe(input: Record<string, unknown>): string {
  const detail = input.command ?? input.file_path ?? input.pattern ?? '';
  return String(detail).split('\n')[0]?.slice(0, 100) ?? '';
}
