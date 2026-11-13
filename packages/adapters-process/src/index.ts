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
  /** Called with each output chunk, for streaming progress to the user. */
  onOutput?: (chunk: string) => void;
}

export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      options.onOutput?.(d.toString());
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      options.onOutput?.(d.toString());
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
