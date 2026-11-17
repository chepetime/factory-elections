// Spawns processes without a shell unless a profile command explicitly needs /bin/sh.
import { spawn } from 'node:child_process';

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  /** Retain only this many UTF-16 characters per stream. Streaming output stays complete. */
  captureLimit?: number;
  /** Optional process deadline for diagnostic commands. */
  timeoutMs?: number;
  /** Called with each output chunk, for streaming progress to the user. */
  onOutput?: (chunk: string) => void;
}

export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<ProcessResult> {
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1))
    throw new RangeError('timeoutMs must be a positive safe integer');
  const limit = options.captureLimit;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
    throw new RangeError('captureLimit must be a nonnegative safe integer');
  const capture = (previous: string, chunk: string) => {
    if (limit === 0) return '';
    const next = previous + chunk;
    return limit === undefined || next.length <= limit ? next : next.slice(-limit);
  };
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    // Decode across chunk boundaries so split UTF-8 characters survive streaming and capture.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = capture(stdout, chunk);
      options.onOutput?.(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = capture(stderr, chunk);
      options.onOutput?.(chunk);
    });
    // A child may exit before consuming input; EPIPE must not crash the parent.
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') stderr = capture(stderr, error.message);
    });
    child.on('error', (error) => resolvePromise({ code: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code, signal) => resolvePromise({ code: code ?? (signal ? 128 : 1), stdout, stderr }));
    child.stdin.end(options.input ?? '');
  });
}

/** Runs a profile command through /bin/sh -c, as approved in the repository profile. */
export function runShell(command: string, options: RunOptions = {}): Promise<ProcessResult> {
  return run('/bin/sh', ['-c', command], options);
}
