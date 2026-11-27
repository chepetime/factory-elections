// Spawns processes without a shell unless a profile command explicitly needs /bin/sh.
import { spawn } from 'node:child_process';
import {
  proxyEnvironment,
  sandboxedCommand,
  sandboxUnavailable,
  startDomainProxy,
  type ShellSandbox,
} from './check-sandbox.ts';

export * from './check-sandbox.ts';

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Why the process was stopped early, when it was. */
  stopped?: 'timeout' | 'aborted' | 'stalled';
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  /** Retain only this many UTF-16 characters per stream. Streaming output stays complete. */
  captureLimit?: number;
  /** Optional process deadline for diagnostic commands. */
  timeoutMs?: number;
  /** Stops the process when it prints nothing on stdout or stderr for this long. */
  stallMs?: number;
  /** Called with each output chunk from stdout and stderr, for streaming progress to the user. */
  onOutput?: (chunk: string) => void;
  /** Called with each stdout chunk only: for callers that parse a protocol on stdout. */
  onStdout?: (chunk: string) => void;
  /** Called with each stderr chunk only: diagnostics, kept apart from protocol data. */
  onStderr?: (chunk: string) => void;
  /** Stops the process when aborted. */
  signal?: AbortSignal;
  /**
   * Run the command in its own process group and stop the whole group on a timeout or abort,
   * so test runners and servers that a check started are stopped too.
   */
  group?: boolean;
}

export interface ShellOptions extends RunOptions {
  /**
   * Run the command in an OS sandbox (see check-sandbox.ts). Needs `env`: the command gets exactly
   * that environment, plus the proxy variables. When the sandbox cannot start, the command does
   * not run (exit code 126); it is never run without it.
   */
  sandbox?: ShellSandbox | undefined;
}

/** How long a stopped process gets between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 5000;

export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<ProcessResult> {
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1))
    throw new RangeError('timeoutMs must be a positive safe integer');
  if (options.stallMs !== undefined && (!Number.isSafeInteger(options.stallMs) || options.stallMs < 1))
    throw new RangeError('stallMs must be a positive safe integer');
  const limit = options.captureLimit;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
    throw new RangeError('captureLimit must be a nonnegative safe integer');
  const capture = (previous: string, chunk: string) => {
    if (limit === 0) return '';
    const next = previous + chunk;
    return limit === undefined || next.length <= limit ? next : next.slice(-limit);
  };
  return new Promise((resolvePromise) => {
    const group = options.group === true;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(group ? { detached: true } : {}),
    });
    let stopped: ProcessResult['stopped'];
    let closed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const signalChild = (sig: NodeJS.Signals) => {
      if (closed || child.pid === undefined) return;
      try {
        if (group) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch (error) {
        // ESRCH: the group is gone. EPERM: on macOS, a group whose processes all exited (only
        // a zombie leader left) refuses signals this way before 'close' fires. Both mean done.
        if (!['ESRCH', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    };
    const stop = (why: NonNullable<ProcessResult['stopped']>) => {
      if (stopped || closed) return;
      stopped = why;
      signalChild('SIGTERM');
      const force = setTimeout(() => signalChild('SIGKILL'), KILL_GRACE_MS);
      force.unref();
      timers.push(force);
    };
    if (options.timeoutMs !== undefined) timers.push(setTimeout(() => stop('timeout'), options.timeoutMs));
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      if (options.stallMs === undefined || stopped) return;
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(() => stop('stalled'), options.stallMs);
    };
    heard();
    const onAbort = () => stop('aborted');
    if (options.signal?.aborted) queueMicrotask(onAbort);
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (result: ProcessResult) => {
      closed = true;
      for (const t of timers) clearTimeout(t);
      if (quiet) clearTimeout(quiet);
      options.signal?.removeEventListener('abort', onAbort);
      resolvePromise(stopped ? { ...result, stopped } : result);
    };
    let stdout = '';
    let stderr = '';
    // Decode across chunk boundaries so split UTF-8 characters survive streaming and capture.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = capture(stdout, chunk);
      heard();
      options.onOutput?.(chunk);
      options.onStdout?.(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = capture(stderr, chunk);
      heard();
      options.onOutput?.(chunk);
      options.onStderr?.(chunk);
    });
    // A child may exit before consuming input; EPIPE must not crash the parent.
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') stderr = capture(stderr, error.message);
    });
    child.on('error', (error) => finish({ code: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code, signal) => {
      // The shell may exit while processes it started still run: stop the rest of the group.
      if (group && stopped) signalChild('SIGKILL');
      finish({ code: code ?? (signal ? 128 : 1), stdout, stderr });
    });
    child.stdin.end(options.input ?? '');
  });
}

/**
 * Runs a profile command via /bin/sh -c, as approved in the repository profile. With
 * `options.sandbox` the command runs under the OS sandbox and fails closed when there is none.
 */
export async function runShell(command: string, options: ShellOptions = {}): Promise<ProcessResult> {
  const { sandbox, ...runOptions } = options;
  if (!sandbox) return run('/bin/sh', ['-c', command], runOptions);
  const refuse = (why: string): ProcessResult => {
    const message = `[not run: ${why}. Checks run in an OS sandbox and are never run without it.]\n`;
    runOptions.onOutput?.(message);
    return { code: 126, stdout: '', stderr: message };
  };
  if (!runOptions.env) return refuse('a sandboxed command needs an explicit environment');
  const unavailable = await sandboxUnavailable();
  if (unavailable) return refuse(unavailable);
  const proxy = await startDomainProxy(sandbox.allowedDomains);
  try {
    const { file, args } = sandboxedCommand(command, sandbox);
    return await run(file, args, {
      ...runOptions,
      env: { ...runOptions.env, ...proxyEnvironment(proxy.port) },
    });
  } finally {
    await proxy.close();
  }
}

export interface DetachedOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Receives the command's stdout and stderr. */
  logPath: string;
  /** Receives the command's exit code when it ends on its own. */
  exitPath: string;
}

/**
 * Starts a command in its own process group that outlives this process. Output goes to
 * `logPath`; the exit code is written to `exitPath`. Returns the process group id.
 */
export function spawnDetached(command: string, args: readonly string[], options: DetachedOptions): number {
  const script = 'log=$1; done=$2; shift 2; "$@" >"$log" 2>&1 </dev/null; echo $? >"$done"';
  const child = spawn('/bin/sh', ['-c', script, 'sh', options.logPath, options.exitPath, command, ...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: true,
    stdio: 'ignore',
  });
  if (child.pid === undefined) throw new Error(`could not start ${command}`);
  child.unref();
  return child.pid;
}

/** Whether a process (or group leader) with this id is alive. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Sends SIGTERM to a process group started by `spawnDetached`. */
export function stopGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
