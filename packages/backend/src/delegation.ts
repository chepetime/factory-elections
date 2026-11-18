// The `delegate` tool: one MCP server, owned by the backend, through which an agent of any provider
// starts a child task on any provider. Children never start each other directly, so the agent
// limit, budgets, depth, shutdown and traces cover them like any other agent.
//
// The server speaks the stateless form of MCP's Streamable HTTP transport: each POST carries
// JSON-RPC messages and gets a JSON reply. Every grant has its own bearer token, which names the
// parent, its working directory, its access and what it may still spend.
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import {
  DelegateInput,
  parseModelRef,
  type McpEndpoint,
  type ModelRun,
  type ModelRunner,
  type ProviderId,
  type ToolAccess,
  type ToolGuard,
} from '@factory/core';

/** How deep children may nest: a parent's child may start one more level, no further. */
export const MAX_DELEGATION_DEPTH = Number(process.env.FACTORY_DELEGATION_DEPTH ?? 2);
/** What a child may spend when the caller names no budget. */
export const CHILD_BUDGET_USD = 2;
const CHILD_TIMEOUT_MS = 30 * 60_000;
const CHILD_STALL_MS = 10 * 60_000;
const DEFAULT_MODEL: Record<ProviderId, string> = { claude: 'claude-sonnet-5-5', codex: 'codex' };

const CHILD_SYSTEM_PROMPT = [
  'You are a child task. Another agent started you with the factory delegate tool.',
  'Do only the task you are given, in the current working directory. Do not commit, push or post anything.',
  'End with a final answer that tells the parent agent what you found or changed.',
].join('\n');

export interface GrantOptions {
  /** For logs, e.g. `coder change-elections/t1` or `review change-elections#12`. */
  label: string;
  cwd: string;
  /** Most children may change: `read-only` children may only read. */
  access: 'read-only' | 'edit';
  budgetUsd: number;
  guard?: ToolGuard;
  signal?: AbortSignal;
  /** Runs the children; pass a traced runner to see them in the parent's trace. */
  runner?: ModelRunner;
  depth?: number;
}

export interface Grant {
  endpoint: McpEndpoint;
  /** Dollars the children reported so far. */
  spent(): number;
  revoke(): void;
}

interface GrantState extends GrantOptions {
  depth: number;
  left: number;
  spentUsd: number;
}

export interface DelegationDeps {
  runner: ModelRunner;
  /** Takes an agent slot at once, or returns undefined when every slot is in use. */
  slot(): Promise<(() => void) | undefined>;
  log?(line: string): void;
}

const Rpc = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
type Rpc = z.infer<typeof Rpc>;

const DELEGATE_SCHEMA = (() => {
  const { $schema: _, ...schema } = z.toJSONSchema(DelegateInput, { io: 'input', target: 'draft-7' });
  return schema;
})();

export class DelegationServer {
  private readonly deps: DelegationDeps;
  private readonly grants = new Map<string, GrantState>();
  private server?: Server;
  /** Stops every running child when the server closes (backend shutdown). */
  private stopping = new AbortController();
  private address?: string;
  constructor(deps: DelegationDeps) {
    this.deps = deps;
  }

  get url(): string | undefined {
    return this.address;
  }

  async start(port = Number(process.env.FACTORY_DELEGATION_PORT ?? 0)): Promise<string> {
    if (this.address) return this.address;
    const server = createServer((req, res) => void this.handle(req, res));
    // A delegate call lasts as long as its child task.
    server.requestTimeout = 0;
    server.timeout = 0;
    await new Promise<void>((done, fail) => {
      server.once('error', fail);
      server.listen(port, '127.0.0.1', () => done());
    });
    this.server = server;
    this.address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    return this.address;
  }

  async close(): Promise<void> {
    this.grants.clear();
    this.stopping.abort();
    this.stopping = new AbortController();
    const server = this.server;
    this.server = undefined;
    this.address = undefined;
    if (server) await new Promise<void>((done) => server.close(() => done()));
    server?.closeAllConnections();
  }

  /** A grant for one parent call, or undefined when the server is not running or depth is spent. */
  grant(options: GrantOptions): Grant | undefined {
    // Depth 0 is a top-level agent. An agent at the limit gets no grant, so it cannot start children.
    const depth = options.depth ?? 0;
    if (!this.address || depth >= MAX_DELEGATION_DEPTH) return undefined;
    const token = randomBytes(24).toString('base64url');
    const state: GrantState = { ...options, depth, left: options.budgetUsd, spentUsd: 0 };
    this.grants.set(token, state);
    return {
      endpoint: { url: this.address, token },
      spent: () => state.spentUsd,
      revoke: () => this.grants.delete(token),
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, body?: unknown) => {
      res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    try {
      if (req.method !== 'POST') return reply(405);
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const grant = token ? this.grants.get(token) : undefined;
      if (!grant) return reply(401, { error: 'unknown or revoked delegate token' });
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const messages = Array.isArray(body) ? body : [body];
      const answers = (await Promise.all(messages.map((m) => this.answer(grant, m)))).filter(
        (a) => a !== undefined,
      );
      if (!answers.length) return reply(202);
      reply(200, Array.isArray(body) ? answers : answers[0]);
    } catch (error) {
      reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: String(error) } });
    }
  }

  private async answer(grant: GrantState, raw: unknown): Promise<unknown> {
    const parsed = Rpc.safeParse(raw);
    if (!parsed.success)
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } };
    const message: Rpc = parsed.data;
    if (message.id === undefined) return undefined; // a notification
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result });
    switch (message.method) {
      case 'initialize':
        return ok({
          protocolVersion:
            typeof message.params?.protocolVersion === 'string'
              ? message.params.protocolVersion
              : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'factory', version: '0.1.0' },
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({
          tools: [
            {
              name: 'delegate',
              description:
                'Start a child task on another agent (claude or codex) and wait for its final answer. ' +
                'Use it for a second opinion or for independent parts of the work. The child gets only the text ' +
                `you give it. It runs in your working directory and counts against the factory's agent limit and your budget ($${grant.left.toFixed(2)} left).`,
              inputSchema: DELEGATE_SCHEMA,
            },
          ],
        });
      case 'tools/call': {
        if (message.params?.name !== 'delegate')
          return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'unknown tool' } };
        const { text, isError } = await this.delegate(grant, message.params.arguments);
        return ok({ content: [{ type: 'text', text }], isError });
      }
      default:
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `unknown method ${message.method}` },
        };
    }
  }

  /** Runs one child task. Failures come back as tool errors the parent can read and act on. */
  async delegate(grant: GrantState, raw: unknown): Promise<{ text: string; isError: boolean }> {
    const input = DelegateInput.safeParse(raw);
    if (!input.success)
      return { text: `Invalid delegate input: ${input.error.issues[0]?.message}`, isError: true };
    const { provider, task, access, model, budget_usd } = input.data;
    if (access === 'edit' && grant.access !== 'edit')
      return { text: 'This agent may start only read-only children.', isError: true };
    if (grant.signal?.aborted) return { text: 'The parent run is stopping.', isError: true };
    const budget = Math.min(budget_usd ?? CHILD_BUDGET_USD, grant.left);
    if (budget < 0.01) return { text: 'No budget is left for child tasks.', isError: true };
    const ref = model ? (provider === 'codex' ? `codex:${model}` : model) : DEFAULT_MODEL[provider];
    if (parseModelRef(ref).provider !== provider)
      return { text: `Model "${model}" is not a ${provider} model.`, isError: true };
    const release = await this.deps.slot();
    if (!release)
      return {
        text: 'Every agent slot is in use. Do this part yourself, or try again later.',
        isError: true,
      };
    const child = this.grant({
      ...grant,
      depth: grant.depth + 1,
      budgetUsd: budget,
      label: `${grant.label} > ${provider}`,
    });
    const runner = grant.runner ?? this.deps.runner;
    const tools: ToolAccess = access;
    const request: ModelRun = {
      step: `delegate:${provider}`,
      model: ref,
      effort: 'medium',
      systemPrompt: CHILD_SYSTEM_PROMPT,
      prompt: task,
      cwd: grant.cwd,
      tools,
      // Codex cannot screen tool calls; its sandbox holds a read-only child. An edit child keeps the guard.
      ...(grant.guard && (provider === 'claude' || access === 'edit') ? { guard: grant.guard } : {}),
      timeoutMs: CHILD_TIMEOUT_MS,
      stallMs: CHILD_STALL_MS,
      maxBudgetUsd: budget,
      maxTurns: 100,
      signal: grant.signal ? AbortSignal.any([grant.signal, this.stopping.signal]) : this.stopping.signal,
      ...(child ? { mcp: child.endpoint } : {}),
    };
    this.deps.log?.(`  · delegate ${grant.label} → ${provider} (${access}, up to $${budget.toFixed(2)})`);
    try {
      const result = await runner.run(request);
      const cost = (result.costUsd ?? 0) + (child?.spent() ?? 0);
      grant.spentUsd += cost;
      grant.left -= cost;
      const spend = result.costUsd === null ? 'cost not reported' : `$${cost.toFixed(2)}`;
      return { text: `Child task (${provider}, ${spend}) finished:\n\n${result.text}`, isError: false };
    } catch (error) {
      const cost =
        (typeof (error as { costUsd?: unknown }).costUsd === 'number'
          ? (error as { costUsd: number }).costUsd
          : 0) + (child?.spent() ?? 0);
      grant.spentUsd += cost;
      grant.left -= cost;
      return {
        text: `Child task (${provider}) failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    } finally {
      child?.revoke();
      release();
    }
  }
}
