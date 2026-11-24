// Codex `app-server` (JSON-RPC over stdio) as a ModelRunner: phase 2 of the roadmap, selected
// with FACTORY_CODEX_TRANSPORT=app-server. The protocol is experimental; this code is written
// against codex-cli 0.172.0 (see ../protocol/README.md for the schema parts it uses).
//
// One process per call: initialize, start or resume a thread, start one turn, read its stream,
// then close stdin. A stop sends the native `turn/interrupt`, waits a bounded time, closes the
// process group, and checks that the commands the server started are gone.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  PROVIDER_CAPABILITIES,
  type AgentEvent,
  type CallCleanup,
  type McpEndpoint,
  type ModelFailure,
  type ModelResult,
  type ModelRun,
  type ModelRunner,
  type ProviderCapabilities,
  type Usage,
} from '@factory/core';
import {
  CODEX_EFFORT,
  CODEX_TOKEN_ENV,
  CodexRunError,
  describe,
  dropOptionalNulls,
  mcpArgs,
  sandboxFor,
  strictSchema,
} from './shared.ts';

/**
 * What the app-server runner enforces. Interrupt is native here. `descendantCleanup` holds because
 * a stop checks the server's process tree and reports `uncertain` when it cannot prove it is gone
 * (docs/runtime-baseline.md, "App-server (phase 2)"). Extra input during a turn is not offered yet.
 */
export const CODEX_APP_SERVER_CAPABILITIES: ProviderCapabilities = {
  ...PROVIDER_CAPABILITIES.codex,
  interrupt: true,
  supplementalInput: false,
  descendantCleanup: true,
};

/** `codex app-server` arguments: the same isolation as `execArgs`, where app-server accepts it. */
export function appServerArgs(o: { mcp?: McpEndpoint } = {}): string[] {
  return [
    'app-server',
    '--listen',
    'stdio://',
    // app-server has no --ignore-user-config: the user's config.toml loads. The thread request
    // sets approval, sandbox, model and instructions, so those user settings do not apply.
    '-c',
    'approval_policy="never"',
    '--disable',
    'apps',
    '--disable',
    'browser_use',
    '--disable',
    'computer_use',
    ...mcpArgs(o.mcp),
  ];
}

/** One JSON-RPC message from the server. The server omits the `jsonrpc` field. */
export interface AppServerMessage {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

/** The message on one stdout line, or undefined for a line that is not a JSON object. */
export function parseAppServerLine(line: string): AppServerMessage | undefined {
  try {
    const m = JSON.parse(line) as unknown;
    return m && typeof m === 'object' && !Array.isArray(m) ? (m as AppServerMessage) : undefined;
  } catch {
    return undefined;
  }
}

type Rec = Record<string, unknown>;
interface Tokens {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

const tokens = (raw: unknown): Tokens | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Rec;
  return {
    inputTokens: Number(t.inputTokens ?? 0),
    outputTokens: Number(t.outputTokens ?? 0),
    cachedInputTokens: Number(t.cachedInputTokens ?? 0),
  };
};
const sameTokens = (a: Tokens | undefined, b: Tokens | undefined) =>
  !!a &&
  !!b &&
  a.inputTokens === b.inputTokens &&
  a.outputTokens === b.outputTokens &&
  a.cachedInputTokens === b.cachedInputTokens;

function toolStart(item: Rec): AgentEvent | undefined {
  const callId = typeof item.id === 'string' ? { callId: item.id } : {};
  switch (item.type) {
    case 'commandExecution':
      return { type: 'tool', name: 'Bash', input: { command: String(item.command ?? '') }, ...callId };
    case 'mcpToolCall':
      return {
        type: 'tool',
        name: `mcp__${String(item.server ?? '')}__${String(item.tool ?? '')}`,
        input: item.arguments && typeof item.arguments === 'object' ? (item.arguments as Rec) : {},
        ...callId,
      };
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? (item.changes as { path?: unknown }[]) : [];
      const path = changes.map((c) => String(c.path)).join(', ');
      return { type: 'tool', name: 'Edit', input: { file_path: path }, ...callId };
    }
    case 'webSearch':
      return { type: 'tool', name: 'WebSearch', input: { pattern: String(item.query ?? '') }, ...callId };
    default:
      return undefined;
  }
}

/**
 * Reads one turn's server messages into the shared events. It is pure, so fixture tests replay
 * real streams through it.
 *
 * Progress: a message counts only when it is the turn's own protocol activity: a response to a
 * request, or a notification or request for this thread (and this turn, when the message names
 * one). Account, rate-limit and other server-wide notifications, non-JSON lines and stderr do not
 * count, and a token-usage snapshot that repeats the last one does not count either.
 */
export class AppServerTurn {
  threadId: string | undefined;
  turnId: string | undefined;
  /** The turn's terminal status from `turn/completed`; undefined while it runs. */
  status: 'completed' | 'interrupted' | 'failed' | undefined;
  /** The last agent message, preferring the final answer. */
  text = '';
  /** Why the turn failed: the last non-retried `error`, or the failed turn's own error. */
  error: string | undefined;
  private finalText: string | undefined;
  /** Thread token totals before this turn (a resumed thread reports them first) and now. */
  private before: Tokens | undefined;
  private total: Tokens | undefined;

  take(m: AppServerMessage): { events: AgentEvent[]; progress: boolean } {
    if (m.method === undefined) return { events: this.response(m), progress: m.id !== undefined };
    const p = m.params ?? {};
    const thread = typeof p.threadId === 'string' ? p.threadId : (p.thread as Rec | undefined)?.id;
    if (!this.threadId || thread !== this.threadId) return { events: [], progress: false };
    if (typeof p.turnId === 'string' && this.turnId && p.turnId !== this.turnId) return this.otherTurn(m);
    return this.notification(m.method, p);
  }

  /** Usage of this turn: the thread totals now minus the totals before it. */
  usage(): Usage | undefined {
    if (!this.total) return undefined;
    const b = this.before ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    return {
      inputTokens: this.total.inputTokens - b.inputTokens,
      outputTokens: this.total.outputTokens - b.outputTokens,
      cachedInputTokens: this.total.cachedInputTokens - b.cachedInputTokens,
    };
  }

  private response(m: AppServerMessage): AgentEvent[] {
    const thread = (m.result?.thread as Rec | undefined)?.id;
    if (typeof thread === 'string' && !this.threadId) {
      this.threadId = thread;
      return [{ type: 'session', id: thread }];
    }
    const turn = (m.result?.turn as Rec | undefined)?.id;
    if (typeof turn === 'string' && !this.turnId) this.turnId = turn;
    return [];
  }

  /** Messages for an earlier turn of a resumed thread: its usage totals are the baseline. */
  private otherTurn(m: AppServerMessage): { events: AgentEvent[]; progress: boolean } {
    if (m.method === 'thread/tokenUsage/updated' && !this.total)
      this.before = tokens((m.params?.tokenUsage as Rec | undefined)?.total) ?? this.before;
    return { events: [], progress: false };
  }

  private notification(method: string, p: Rec): { events: AgentEvent[]; progress: boolean } {
    const item = (p.item ?? {}) as Rec;
    switch (method) {
      case 'item/started': {
        // Commands and MCP calls show when they start; file changes and searches when they end.
        const tool =
          item.type === 'commandExecution' || item.type === 'mcpToolCall' ? toolStart(item) : undefined;
        return { events: tool ? [tool] : [], progress: true };
      }
      case 'item/completed':
        return { events: this.completed(item), progress: true };
      case 'thread/tokenUsage/updated': {
        const total = tokens((p.tokenUsage as Rec | undefined)?.total);
        if (!this.turnId) {
          this.before = total ?? this.before;
          return { events: [], progress: true };
        }
        const repeat = sameTokens(total, this.total);
        if (total) this.total = total;
        return { events: [], progress: !repeat };
      }
      case 'error': {
        const error = (p.error ?? {}) as Rec;
        if (p.willRetry !== true) this.error = String(error.message ?? 'Codex error');
        return { events: [], progress: true };
      }
      case 'turn/completed': {
        const turn = (p.turn ?? {}) as Rec;
        if (this.turnId && turn.id !== this.turnId) return { events: [], progress: false };
        const status = turn.status === 'completed' || turn.status === 'interrupted' ? turn.status : 'failed';
        this.status = status;
        this.text = this.finalText ?? this.text;
        const error = (turn.error as Rec | null | undefined)?.message;
        const usage = this.usage();
        const ok = status === 'completed';
        if (!ok) this.error = String(error ?? this.error ?? `Codex turn ${status}`);
        return {
          events: [
            {
              type: 'result',
              ok,
              text: ok ? '' : this.error!,
              ...(usage ? { usage } : {}),
            },
          ],
          progress: true,
        };
      }
      default:
        // Deltas, status changes, MCP startup and other thread messages: activity, no event.
        return { events: [], progress: true };
    }
  }

  private completed(item: Rec): AgentEvent[] {
    const callId = typeof item.id === 'string' ? { callId: item.id } : {};
    switch (item.type) {
      case 'agentMessage': {
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) return [];
        this.text = text;
        if (item.phase === 'final_answer') this.finalText = text;
        return [{ type: 'text', text }];
      }
      case 'commandExecution':
        return [
          {
            type: 'tool-result',
            ok: item.status === 'completed' && item.exitCode === 0,
            text: String(item.aggregatedOutput ?? '').slice(-2000),
            ...callId,
          },
        ];
      case 'mcpToolCall':
        return [
          {
            type: 'tool-result',
            ok: item.status !== 'failed',
            text: JSON.stringify(item.error ?? item.result ?? '').slice(0, 2000),
            ...callId,
          },
        ];
      case 'fileChange':
      case 'webSearch': {
        const tool = toolStart(item);
        return tool ? [tool] : [];
      }
      default:
        return [];
    }
  }
}

/**
 * The answer to a request the server sends. The factory runs with approval policy `never` and
 * screens no tool calls, so every approval, question and elicitation is declined, the same way
 * each time. Methods this code does not know get a JSON-RPC error.
 */
export function answerServerRequest(
  method: string,
): { result: Rec } | { error: { code: number; message: string } } {
  const why = 'the factory runs Codex with approval policy never and does not answer prompts';
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { result: { decision: 'decline' } };
    case 'execCommandApproval':
    case 'applyPatchApproval':
      return { result: { decision: { denied: { rejection: why } } } };
    case 'mcpServer/elicitation/request':
      return { result: { action: 'decline', content: null, _meta: null } };
    case 'item/tool/call':
      return { result: { contentItems: [], success: false } };
    default:
      return { error: { code: -32601, message: `${method} is not supported: ${why}` } };
  }
}

/** A JSON-RPC error answer from the server. */
export class AppServerRpcError extends Error {
  readonly code: number;
  constructor(method: string, error: { code: number; message: string }) {
    super(`${method} failed: ${error.message}`);
    this.code = error.code;
  }
}

/**
 * The server rejected the session to resume (for example, "no rollout found for thread id").
 * The runner never starts a fresh thread in its place: a caller that wants a fresh start must
 * decide so, say so, and rebuild the context itself.
 */
export class CodexResumeRejected extends CodexRunError {
  readonly resumeRejected = true;
  readonly sessionId: string;
  constructor(sessionId: string, detail: string) {
    super(`model run failed (codex): the session ${sessionId} could not be resumed: ${detail}`, 'error');
    this.sessionId = sessionId;
  }
}

/** What happened to the native interrupt of a stopped turn. */
export interface InterruptRecord {
  /** `turn/interrupt` was sent (a turn id was known and the server was running). */
  sent: boolean;
  /** The server answered it without an error. */
  acknowledged: boolean;
  /** `turn/completed` arrived before the bounded wait ended. */
  turnCompleted: boolean;
  /** Processes under the server when the stop began (after the interrupt wait). */
  descendantsSeen: number;
  /** Descendants that outlived the server and that the runner stopped itself. */
  descendantsKilled: number;
}

/** A stopped app-server call: the kind, the cleanup evidence, and what the interrupt did. */
export class CodexAppServerStopped extends CodexRunError {
  readonly interrupt: InterruptRecord;
  constructor(message: string, kind: ModelFailure, cleanup: CallCleanup, interrupt: InterruptRecord) {
    super(message, kind, cleanup);
    this.interrupt = interrupt;
  }
}

export interface CodexAppServerRunnerOptions {
  /** The binary; default `codex`. */
  command?: string;
  /** Arguments before `app-server`, e.g. a fake server script under `node`. */
  commandArgs?: string[];
  onProgress?: (line: string) => void;
  /** Every stdout line, raw: for fixture capture. */
  onProtocolLine?: (line: string) => void;
  /** stderr chunks: diagnostics only. */
  onDiagnostic?: (chunk: string) => void;
  /** Bound for each startup request (initialize, thread, turn/start). Default 30 s. */
  startupTimeoutMs?: number;
  /** How long a stop waits for the interrupt answer and `turn/completed`. Default 5 s. */
  interruptGraceMs?: number;
  /** How long the server gets to exit after stdin closes, and again after SIGTERM. Default 3 s. */
  exitGraceMs?: number;
  stallCheckMs?: number;
}

type StopKind = 'aborted' | 'timeout' | 'stalled';
const STOP_MESSAGE: Record<StopKind, string> = {
  aborted: 'model run stopped: the backend is shutting down or the run was cancelled',
  timeout: 'model run stopped: it reached its time limit',
  stalled: 'model run stopped: no message from the model within the stall limit',
};

class Stop extends Error {}
class Transport extends Error {}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms).unref());

/** The server process: newline-delimited JSON-RPC on stdout, diagnostics on stderr. */
class Connection {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exited: Promise<void>;
  exit: { code: number | null; signal: string | null; error?: string } | undefined;
  stderr = '';
  private next = 1;
  private pending = new Map<
    number,
    { method: string; resolve: (r: Rec) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private buffer = '';

  constructor(
    command: string,
    args: string[],
    options: { cwd?: string; env: NodeJS.ProcessEnv },
    onLine: (line: string) => void,
    onStderr: (chunk: string) => void,
  ) {
    // Its own process group, so a stop can end the server and what it started together.
    this.child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: 'pipe', detached: true });
    this.exited = new Promise((done) => {
      const end = (exit: NonNullable<Connection['exit']>) => {
        if (this.exit) return;
        this.exit = exit;
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Transport(this.describeExit(p.method)));
        }
        this.pending.clear();
        done();
      };
      this.child.on('error', (e) => end({ code: null, signal: null, error: e.message }));
      this.child.on('close', (code, signal) => end({ code, signal }));
    });
    // The decoder keeps a UTF-8 character that a chunk boundary splits.
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).replace(/\r$/, '');
        this.buffer = this.buffer.slice(i + 1);
        if (line) onLine(line);
      }
    });
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-16 * 1024);
      onStderr(chunk);
    });
    this.child.stdin.on('error', () => {});
  }

  describeExit(method?: string): string {
    const e = this.exit;
    const how = e?.error ?? (e?.signal ? `signal ${e.signal}` : `exit ${e?.code ?? '?'}`);
    const tail = this.stderr.trim().split('\n').slice(-3).join('\n');
    return `codex app-server ended (${how})${method ? ` before it answered ${method}` : ''}${tail ? `: ${tail}` : ''}`;
  }

  /** Resolves a response from `onLine`; returns true when the message was one. */
  settle(m: AppServerMessage): boolean {
    if (m.method !== undefined || typeof m.id !== 'number') return false;
    const p = this.pending.get(m.id);
    if (!p) return false;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error) p.reject(new AppServerRpcError(p.method, m.error));
    else p.resolve(m.result ?? {});
    return true;
  }

  request(method: string, params: Rec, timeoutMs: number): Promise<Rec> {
    if (this.exit) return Promise.reject(new Transport(this.describeExit(method)));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Transport(`codex app-server did not answer ${method} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string): void {
    this.write({ method });
  }

  respond(id: string | number, answer: ReturnType<typeof answerServerRequest>): void {
    this.write({ id, ...answer });
  }

  private write(message: Rec): void {
    if (!this.exit && this.child.stdin.writable) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  signalGroup(signal: NodeJS.Signals): void {
    if (this.child.pid === undefined) return;
    try {
      process.kill(-this.child.pid, signal);
    } catch {
      // ESRCH: the group is gone already.
    }
  }

  /** Close stdin, then SIGTERM and SIGKILL the group, each after a bounded wait. */
  async shutdown(graceMs: number): Promise<void> {
    this.child.stdin.end();
    const gone = () => Promise.race([this.exited.then(() => true), wait(graceMs).then(() => false)]);
    if (!(await gone())) {
      this.signalGroup('SIGTERM');
      if (!(await gone())) {
        this.signalGroup('SIGKILL');
        await gone();
      }
    }
    // Members of the group that outlive its leader (a shell's child, say) stop here too.
    this.signalGroup('SIGKILL');
  }
}

/** Pids of every process under `root`, from one `ps` listing; undefined when `ps` fails. */
function descendants(root: number): Promise<number[] | undefined> {
  return new Promise((done) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid='], { timeout: 5_000 }, (error, stdout) => {
      if (error) return done(undefined);
      const children = new Map<number, number[]>();
      for (const line of stdout.split('\n')) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number);
        if (!pid || ppid === undefined || Number.isNaN(ppid)) continue;
        children.set(ppid, [...(children.get(ppid) ?? []), pid]);
      }
      const out: number[] = [];
      const queue = [root];
      while (queue.length)
        for (const c of children.get(queue.shift()!) ?? []) {
          out.push(c);
          queue.push(c);
        }
      done(out);
    });
  });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export class CodexAppServerRunner implements ModelRunner {
  readonly options: CodexAppServerRunnerOptions;
  readonly capabilities = CODEX_APP_SERVER_CAPABILITIES;
  constructor(options: CodexAppServerRunnerOptions = {}) {
    this.options = options;
  }

  async run(request: ModelRun): Promise<ModelResult> {
    if (request.guard)
      throw new CodexRunError('codex cannot screen each tool call, so it cannot run a guarded step', 'error');
    if (request.signal?.aborted) throw new CodexRunError('model run stopped: aborted', 'aborted');
    const o = this.options;
    const startup = o.startupTimeoutMs ?? 30_000;
    const turn = new AppServerTurn();
    let last = Date.now();
    let stopKind: StopKind | undefined;
    let stopNow: () => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      stopNow = () => reject(new Stop());
    });
    stopped.catch(() => {});
    const stop = (kind: StopKind) => {
      if (stopKind) return;
      stopKind = kind;
      stopNow();
    };
    let completeTurn: () => void = () => {};
    const turnDone = new Promise<void>((done) => (completeTurn = done));

    const conn = new Connection(
      o.command ?? 'codex',
      [...(o.commandArgs ?? []), ...appServerArgs(request.mcp ? { mcp: request.mcp } : {})],
      {
        ...(request.cwd ? { cwd: request.cwd } : {}),
        env: {
          ...process.env,
          ...request.env,
          ...(request.mcp ? { [CODEX_TOKEN_ENV]: request.mcp.token } : {}),
        },
      },
      (line) => {
        o.onProtocolLine?.(line);
        const m = parseAppServerLine(line);
        if (!m) return;
        const { events, progress } = turn.take(m);
        if (progress) last = Date.now();
        for (const event of events) {
          request.onEvent?.(event);
          if (event.type === 'tool') o.onProgress?.(`  · ${event.name} ${describe(event.input)}`);
        }
        if (m.method !== undefined && m.id !== undefined) {
          o.onProgress?.(`  · codex asked ${m.method}; declined`);
          conn.respond(m.id, answerServerRequest(m.method));
        }
        conn.settle(m);
        if (turn.status) completeTurn();
      },
      (chunk) => o.onDiagnostic?.(chunk),
    );

    const onAbort = () => stop('aborted');
    request.signal?.addEventListener('abort', onAbort, { once: true });
    const timers: NodeJS.Timeout[] = [];
    if (request.timeoutMs) timers.push(setTimeout(() => stop('timeout'), request.timeoutMs));
    if (request.stallMs) {
      const every = o.stallCheckMs ?? Math.min(30_000, Math.max(10, request.stallMs / 4));
      timers.push(
        setInterval(() => {
          if (Date.now() - last >= request.stallMs!) stop('stalled');
        }, every),
      );
    }
    const race = <T>(p: Promise<T>) => Promise.race([p, stopped]);
    const exitedEarly = conn.exited.then(() => {
      throw new Transport(conn.describeExit());
    });
    exitedEarly.catch(() => {});

    try {
      await race(
        conn.request(
          'initialize',
          {
            clientInfo: { name: 'factory', title: null, version: '0' },
            capabilities: { experimentalApi: false, requestAttestation: false },
          },
          startup,
        ),
      );
      conn.notify('initialized');
      const model = request.model === 'codex' ? undefined : request.model.replace(/^codex:/, '');
      const thread: Rec = {
        ...(model ? { model } : {}),
        ...(request.cwd ? { cwd: request.cwd } : {}),
        approvalPolicy: 'never',
        sandbox: sandboxFor(request.tools),
        ...(request.systemPrompt ? { developerInstructions: request.systemPrompt } : {}),
      };
      if (request.resume) {
        try {
          await race(
            conn.request(
              'thread/resume',
              { threadId: request.resume, ...thread, excludeTurns: true },
              startup,
            ),
          );
        } catch (error) {
          if (error instanceof AppServerRpcError)
            throw new CodexResumeRejected(request.resume, error.message);
          throw error;
        }
      } else await race(conn.request('thread/start', thread, startup));
      if (!turn.threadId) throw new Transport('codex app-server returned no thread id');
      await race(
        conn.request(
          'turn/start',
          {
            threadId: turn.threadId,
            input: [{ type: 'text', text: request.prompt, text_elements: [] }],
            ...(request.effort ? { effort: CODEX_EFFORT[request.effort] } : {}),
            ...(request.outputSchema ? { outputSchema: strictSchema(request.outputSchema) } : {}),
          },
          startup,
        ),
      );
      await race(Promise.race([turnDone, exitedEarly]));
    } catch (error) {
      if (error instanceof Stop) throw await this.stopped(conn, turn, stopKind!, turnDone);
      await conn.shutdown(o.exitGraceMs ?? 3_000);
      if (error instanceof CodexRunError) throw error;
      // A server that died during a turn leaves no tree to check: its commands may still run.
      const cleanup: CallCleanup | undefined = turn.turnId
        ? { status: 'uncertain', reason: 'codex app-server ended during the turn' }
        : undefined;
      throw new CodexRunError(
        `model run failed (codex app-server): ${(error as Error).message}`,
        undefined,
        cleanup,
      );
    } finally {
      for (const t of timers) clearTimeout(t);
      request.signal?.removeEventListener('abort', onAbort);
    }

    // The turn ended: close the server. Cleanup after a finished turn never fails the result.
    await conn.shutdown(o.exitGraceMs ?? 3_000);
    if (turn.status !== 'completed') {
      const result = turn.status ? `turn ${turn.status}` : 'no result';
      throw new CodexRunError(`model run failed (codex): ${turn.error ?? result}`);
    }
    let structured: unknown;
    if (request.outputSchema) {
      try {
        structured = dropOptionalNulls(JSON.parse(turn.text), request.outputSchema);
      } catch {
        throw new CodexRunError('model run failed (codex): the final answer is not the requested JSON');
      }
    }
    const usage = turn.usage();
    return {
      text: turn.text,
      ...(structured !== undefined ? { structured } : {}),
      costUsd: null,
      ...(turn.threadId ? { sessionId: turn.threadId } : {}),
      ...(usage ? { usage } : {}),
    };
  }

  /** Interrupt, bounded wait, process-group stop, then a descendant check. */
  private async stopped(
    conn: Connection,
    turn: AppServerTurn,
    kind: StopKind,
    turnDone: Promise<void>,
  ): Promise<CodexAppServerStopped> {
    const grace = this.options.interruptGraceMs ?? 5_000;
    const record: InterruptRecord = {
      sent: false,
      acknowledged: false,
      turnCompleted: false,
      descendantsSeen: 0,
      descendantsKilled: 0,
    };
    if (turn.threadId && turn.turnId && !conn.exit) {
      record.sent = true;
      const deadline = Date.now() + grace;
      record.acknowledged = await conn
        .request('turn/interrupt', { threadId: turn.threadId, turnId: turn.turnId }, grace)
        .then(
          () => true,
          () => false,
        );
      record.turnCompleted = await Promise.race([
        turnDone.then(() => true),
        conn.exited.then(() => false),
        wait(Math.max(0, deadline - Date.now())).then(() => false),
      ]);
    }
    const root = conn.child.pid;
    const before = root !== undefined && !conn.exit ? await descendants(root) : [];
    record.descendantsSeen = before?.length ?? 0;
    await conn.shutdown(this.options.exitGraceMs ?? 3_000);
    let cleanup: CallCleanup;
    if (!before)
      cleanup = { status: 'uncertain', reason: 'could not list the processes codex app-server started' };
    else {
      const survivors = before.filter(alive);
      for (const pid of survivors)
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      record.descendantsKilled = survivors.length;
      if (survivors.length) await wait(200);
      const left = survivors.filter(alive);
      cleanup = left.length
        ? {
            status: 'uncertain',
            reason: `${left.length} process(es) codex app-server started still run after a stop`,
          }
        : { status: 'clean' };
    }
    if (!conn.exit) cleanup = { status: 'uncertain', reason: 'codex app-server did not exit after SIGKILL' };
    return new CodexAppServerStopped(STOP_MESSAGE[kind], kind, cleanup, record);
  }
}
