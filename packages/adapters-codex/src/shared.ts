// What both Codex transports share: the `codex exec` runner (index.ts) and the app-server runner
// (app-server.ts). Sandbox by access, effort names, MCP overrides, strict output schemas and errors.
import {
  modelFailureKind,
  type CallCleanup,
  type Effort,
  type McpEndpoint,
  type ModelFailure,
  type ToolAccess,
} from '@factory/core';

/** The env var that carries the `delegate` token to Codex's MCP client. */
export const CODEX_TOKEN_ENV = 'FACTORY_DELEGATE_TOKEN';

/** Codex reasoning effort for each factory effort. */
export const CODEX_EFFORT: Record<Effort, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'xhigh',
};

/** A TOML basic string. JSON string escapes are valid TOML escapes. */
export const toml = (value: string) => JSON.stringify(value);

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

/** `-c` overrides that give Codex the backend's MCP server; the token stays in CODEX_TOKEN_ENV. */
export function mcpArgs(mcp: McpEndpoint | undefined): string[] {
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

/** Why a stopped Codex call cannot be called clean (docs/runtime-baseline.md, finding 1). */
export const CODEX_STOP_CLEANUP: CallCleanup = {
  status: 'uncertain',
  reason: 'codex was stopped, and a stopped codex exec can leave its shell command running',
};

export class CodexRunError extends Error {
  readonly costUsd = null;
  readonly kind: ModelFailure;
  /** Set when the call was stopped early; see ADR 0005. */
  readonly cleanup: CallCleanup | undefined;
  constructor(message: string, kind: ModelFailure = modelFailureKind(message), cleanup?: CallCleanup) {
    super(message);
    this.kind = kind;
    this.cleanup = cleanup;
  }
}

/** One short line for a tool call's input, for progress logs. */
export function describe(input: Record<string, unknown>): string {
  const detail = input.command ?? input.file_path ?? input.pattern ?? '';
  return String(detail).split('\n')[0]?.slice(0, 100) ?? '';
}
