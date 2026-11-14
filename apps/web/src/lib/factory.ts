// Server-only bridge to the factory CLI. The web app keeps no state of its own: every read and
// every action runs `factory` with Node, without a shell, and validates what comes back.
import 'server-only';
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { NAME_PATTERN, Project, TaskRecord } from '@factory/core';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProjectName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

export function isTaskId(id: string): boolean {
  return UUID.test(id);
}

/** Absolute path of the factory CLI script, or undefined when it is not configured correctly. */
export function cliScript(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const script = env.FACTORY_CLI_SCRIPT;
  if (script === undefined) return resolve(process.cwd(), '..', '..', 'bin', 'factory');
  return isAbsolute(script) ? script : undefined;
}

export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.FACTORY_ROOT ? resolve(env.FACTORY_ROOT) : join(homedir(), '.local', 'share', 'factory');
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Next's own variables must not leak into a CLI child process.
  delete env.NODE_OPTIONS;
  delete env.__NEXT_PRIVATE_ORIGIN;
  return env;
}

interface CliOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCli(args: string[], timeoutMs = 60_000): Promise<CliOutput | undefined> {
  const script = cliScript();
  if (!script) return Promise.resolve(undefined);
  return new Promise((done) => {
    execFile(
      process.execPath,
      [script, ...args],
      { env: childEnv(), timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        done({ code, stdout, stderr });
      },
    );
  });
}

/** The CLI's own error line, without "error: " and with the data root path removed. */
function cliError(out: CliOutput | undefined, fallback: string): string {
  if (!out) return 'The factory CLI is not configured (FACTORY_CLI_SCRIPT must be an absolute path).';
  const line = out.stderr
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('error:'));
  return (line ? line.replace(/^error:\s*/, '') : fallback).replaceAll(dataRoot(), '<data root>');
}

async function readJson<T extends z.ZodType>(args: string[], schema: T): Promise<Result<z.infer<T>>> {
  const out = await runCli(args);
  if (!out || out.code !== 0) return { ok: false, error: cliError(out, 'The factory CLI failed.') };
  let parsed: unknown;
  try {
    parsed = JSON.parse(out.stdout);
  } catch {
    return { ok: false, error: 'The factory CLI returned invalid JSON.' };
  }
  const checked = schema.safeParse(parsed);
  return checked.success
    ? { ok: true, value: checked.data }
    : { ok: false, error: 'The factory CLI returned an invalid record.' };
}

export function listProjects(): Promise<Result<Project[]>> {
  return readJson(['project', 'list'], z.array(Project));
}

export function listTasks(project: string): Promise<Result<TaskRecord[]>> {
  return readJson(['task', 'list', '--project', project], z.array(TaskRecord));
}

export function showTask(project: string, id: string): Promise<Result<TaskRecord>> {
  return readJson(['task', 'show', '--project', project, '--id', id], TaskRecord);
}

export const Gate = z.object({
  task: TaskRecord,
  head_sha: z.string().min(1),
  diff_stat: z.string(),
  blockers: z.array(z.string()),
});
export type Gate = z.infer<typeof Gate>;

export function readGate(project: string, id: string): Promise<Result<Gate>> {
  return readJson(['task', 'gate', '--project', project, '--id', id, '--json'], Gate);
}

export async function readDiff(project: string, id: string): Promise<Result<string>> {
  const out = await runCli(['task', 'diff', '--project', project, '--id', id]);
  return out && out.code === 0
    ? { ok: true, value: out.stdout }
    : { ok: false, error: cliError(out, 'Diff unavailable.') };
}

/** Runs a short CLI command and returns its first standard-output line. */
export async function command(args: string[], timeoutMs = 120_000): Promise<Result<string>> {
  const out = await runCli(args, timeoutMs);
  if (!out || out.code !== 0) return { ok: false, error: cliError(out, 'The command failed.') };
  return { ok: true, value: out.stdout.trim().split('\n')[0] ?? '' };
}

// ---------- long-running work in the background ----------

function taskDir(project: string, id: string): string {
  return join(dataRoot(), project, 'tasks', id);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface BackgroundRun {
  running: boolean;
  label?: string;
  logTail?: string;
}

/** Whether a web-started `task run` or `task revise` is still running, with the end of its log. */
export function backgroundRun(project: string, id: string): BackgroundRun {
  const dir = taskDir(project, id);
  let running = false;
  let label: string | undefined;
  try {
    const lock = JSON.parse(readFileSync(join(dir, 'web-run.json'), 'utf8')) as {
      pid: number;
      label: string;
    };
    running = alive(lock.pid);
    label = lock.label;
  } catch {
    // No run started from the web app.
  }
  let logTail: string | undefined;
  try {
    const log = readFileSync(join(dir, 'web-run.log'), 'utf8');
    logTail = log.length > 8000 ? `…${log.slice(-8000)}` : log;
  } catch {
    logTail = undefined;
  }
  return { running, label, logTail };
}

/** Starts `factory task <args>` detached, logging to the task directory. One run per task at a time. */
export function startBackground(project: string, id: string, label: string, args: string[]): Result<string> {
  const script = cliScript();
  if (!script) return { ok: false, error: 'The factory CLI is not configured.' };
  if (backgroundRun(project, id).running)
    return { ok: false, error: 'A run is already in progress for this task.' };
  const dir = taskDir(project, id);
  mkdirSync(dir, { recursive: true });
  const log = openSync(join(dir, 'web-run.log'), 'w');
  try {
    const child = spawn(process.execPath, [script, 'task', ...args], {
      detached: true,
      stdio: ['ignore', log, log],
      env: childEnv(),
    });
    if (!child.pid) return { ok: false, error: 'Could not start the factory CLI.' };
    writeFileSync(join(dir, 'web-run.json'), JSON.stringify({ pid: child.pid, label }));
    child.unref();
    return { ok: true, value: label };
  } finally {
    closeSync(log);
  }
}

export function clearBackgroundLog(project: string, id: string): void {
  rmSync(join(taskDir(project, id), 'web-run.log'), { force: true });
}
