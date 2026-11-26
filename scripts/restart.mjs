#!/usr/bin/env node
// Restarts the running factory stack of this checkout so it runs the current code:
//   1. refuses while a run works or waits (unless --force), and names those tasks;
//   2. sends SIGTERM to this checkout's scripts/web.mjs, so the backend drains and removes its lock;
//   3. starts `scripts/start.mjs` detached (logs in <data root>/logs/stack.log);
//   4. waits for the backend RPC and the web app, then prints one status line.
// Usage: pnpm restart [--force] [--prod] [--from-agent-session]. --prod builds; the default is dev.
import './load-env.ts';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataRoot } from '../packages/adapters-fs/src/index.ts';
import { backendCall, closeBackendClient } from '../packages/backend-client/src/client.ts';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dataRoot();
const args = process.argv.slice(2);
const force = args.includes('--force');
const startArgs = [
  ...(args.includes('--prod') ? [] : ['--dev']),
  ...(args.includes('--from-agent-session') ? ['--from-agent-session'] : []),
];
process.env.FACTORY_BACKEND_ADDRESS ??= `127.0.0.1:${process.env.FACTORY_BACKEND_PORT ?? 4319}`;
const port = process.env.PORT ?? '3000';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Tasks whose run works or waits for an agent: a restart would cut or delay them. */
async function busyTasks() {
  const projects = JSON.parse((await backendCall('ListProjects', {}, 5000)).json);
  const busy = [];
  for (const { name } of projects) {
    const issues = JSON.parse((await backendCall('ListIssues', { project: name, id: '' }, 10_000)).json);
    const items = Array.isArray(issues) ? issues : (issues.items ?? []);
    for (const i of items) if (i.run?.owned || i.run?.waiting) busy.push(`${name}/${i.key}`);
  }
  return busy;
}

/** The scripts/web.mjs processes of this checkout (not of other worktrees). */
function webPids() {
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  const script = join(repo, 'scripts', 'web.mjs');
  return out
    .split('\n')
    .filter((line) => line.includes(script))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter(Number.isInteger);
}

async function reachable() {
  try {
    await backendCall('ListProjects', {}, 1000);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const running = webPids();
  if (running.length && (await reachable())) {
    const busy = await busyTasks();
    if (busy.length && !force) {
      console.error(`Not restarting: these tasks have a run working or waiting: ${busy.join(', ')}.`);
      console.error('Wait for them, or pass --force (the backend drains them for up to 5 min).');
      process.exitCode = 1;
      return;
    }
    if (busy.length) console.log(`Restarting anyway; the drain may cut: ${busy.join(', ')}.`);
  }
  closeBackendClient();

  for (const pid of running) process.kill(pid, 'SIGTERM');
  if (running.length) process.stdout.write(`Stopping web.mjs (${running.join(', ')})`);
  const lock = join(root, 'backend.lock');
  for (let i = 0; i < 360 && (webPids().length || existsSync(lock)); i++) {
    if (i % 5 === 0 && running.length) process.stdout.write('.');
    await sleep(1000);
  }
  if (running.length) process.stdout.write('\n');
  if (webPids().length)
    throw new Error('web.mjs did not stop within 6 min; inspect it before starting again.');
  if (existsSync(lock))
    throw new Error(`The backend left ${lock}; check that it stopped, then remove the lock.`);

  mkdirSync(join(root, 'logs'), { recursive: true });
  const logPath = join(root, 'logs', 'stack.log');
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, [join(repo, 'scripts', 'start.mjs'), ...startArgs], {
    cwd: repo,
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();

  let backend = false;
  let web = false;
  for (let i = 0; i < 180 && !(backend && web); i++) {
    await sleep(1000);
    if (child.exitCode !== null) throw new Error(`start.mjs exited with ${child.exitCode}; see ${logPath}.`);
    backend ||= await reachable();
    if (backend && !web)
      web = await fetch(`http://localhost:${port}/api/projects`, { signal: AbortSignal.timeout(60_000) })
        .then((r) => r.ok)
        .catch(() => false);
  }
  closeBackendClient();
  if (!backend || !web) throw new Error(`The stack did not come up within 3 min; see ${logPath}.`);
  const head = execFileSync('git', ['log', '--oneline', '-1'], { cwd: repo, encoding: 'utf8' }).trim();
  console.log(`Running ${head} at http://localhost:${port} (pid ${child.pid}, log ${logPath}).`);
}

main().catch((error) => {
  closeBackendClient();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
