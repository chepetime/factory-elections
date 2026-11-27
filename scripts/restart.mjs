#!/usr/bin/env node
// Restarts the running factory stack of this checkout so it runs the current code:
//   1. refuses while a run works or waits (unless --force), and names those tasks;
//   2. sends SIGTERM to this checkout's scripts/web.mjs, so the backend drains and removes its lock;
//   3. starts `scripts/start.mjs` detached (logs in <data root>/logs/stack.log);
//   4. waits for the backend RPC and the web app, then prints one status line.
// Usage: pnpm restart [--force] [--prod] [--from-agent-session] [--dry-run]. --prod builds; the
// default is dev. --dry-run prints what it would stop and why, and changes nothing. It runs only in
// the primary checkout: a worktree runs its own stack with `pnpm worktree run`.
import './load-env.ts';
import { spawn, spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataRoot } from '../packages/adapters-fs/src/index.ts';
import { backendCall, closeBackendClient } from '../packages/backend-client/src/client.ts';
import { LABEL } from './service.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dataRoot();
const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
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
  // PR review turns run inside the backend too; a restart would cut them.
  const health = await fetch(`http://127.0.0.1:${process.env.FACTORY_HEALTH_PORT ?? 4318}/health`, {
    signal: AbortSignal.timeout(5000),
  })
    .then((r) => r.json())
    .catch(() => ({}));
  if (health.reviews_running) busy.push(`${health.reviews_running} PR review turn(s)`);
  return busy;
}

/** The scripts/web.mjs processes of this checkout (not of other worktrees), by command and cwd. */
function webPids() {
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  const script = join(repo, 'scripts', 'web.mjs');
  return out
    .split('\n')
    .filter((line) => /(^|\s|\/)scripts\/web\.mjs(\s|$)/.test(line) && !/^\s*\d+\s+sh -c/.test(line))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter(Number.isInteger)
    .filter((pid) => {
      // `node scripts/web.mjs` (from pnpm web) has a relative path: its cwd says which checkout.
      const line = out.split('\n').find((l) => Number(l.trim().split(/\s+/)[0]) === pid) ?? '';
      if (line.includes(script)) return true;
      try {
        const cwd = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
          .split('\n')
          .find((l) => l.startsWith('n'))
          ?.slice(1);
        return cwd === repo;
      } catch {
        return false;
      }
    });
}

/** Next.js processes still running from this checkout's apps/web (by cwd), e.g. left by an old web.mjs. */
function nextPids() {
  const web = join(repo, 'apps', 'web');
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((line) => /next-server|next\/dist\/bin\/next (dev|start)/.test(line))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter(Number.isInteger)
    .filter((pid) => {
      try {
        const cwd = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
          .split('\n')
          .find((l) => l.startsWith('n'))
          ?.slice(1);
        return cwd === web;
      } catch {
        return false;
      }
    });
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
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  if (dirname(common) !== repo)
    throw new Error(
      `${repo} is a linked worktree. Restart the primary checkout, or use pnpm worktree run here.`,
    );
  // Installed as a launchd agent (scripts/service.mjs): launchd stops it with a drain and starts it.
  const uid = execFileSync('id', ['-u'], { encoding: 'utf8' }).trim();
  const service = spawnSync('launchctl', ['print', `gui/${uid}/${LABEL}`], { stdio: 'ignore' }).status === 0;
  const running = webPids();
  if (dryRun) {
    const busy = running.length && (await reachable()) ? await busyTasks() : [];
    closeBackendClient();
    console.log(
      JSON.stringify({
        checkout: repo,
        data_root: root,
        web_pids: running,
        busy,
        would_restart: !busy.length || force,
      }),
    );
    return;
  }
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

  if (service) {
    execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${LABEL}`], { stdio: 'inherit' });
    await waitUp(undefined, join(root, 'logs', 'stack.log'));
    return;
  }

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
  // A web.mjs from before it stopped its whole process group leaves next running on the port.
  const strays = nextPids();
  if (strays.length) {
    console.log(`Stopping leftover Next.js (${strays.join(', ')}).`);
    for (const pid of strays) process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 30 && nextPids().length; i++) await sleep(1000);
    if (nextPids().length) throw new Error(`Next.js (${nextPids().join(', ')}) did not stop; inspect it.`);
  }

  mkdirSync(join(root, 'logs'), { recursive: true });
  const logPath = join(root, 'logs', 'stack.log');
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, [join(repo, 'scripts', 'start.mjs'), ...startArgs], {
    cwd: repo,
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();

  await waitUp(child, logPath);
  console.log(`(started pid ${child.pid})`);
}

/** Waits for the backend RPC and the web app, then prints the running commit. */
async function waitUp(child, logPath) {
  let backend = false;
  let web = false;
  for (let i = 0; i < 400 && !(backend && web); i++) {
    await sleep(1000);
    if (child && child.exitCode !== null)
      throw new Error(`start.mjs exited with ${child.exitCode}; see ${logPath}.`);
    backend ||= await reachable();
    if (backend && !web)
      web = await fetch(`http://localhost:${port}/api/projects`, { signal: AbortSignal.timeout(60_000) })
        .then((r) => r.ok)
        .catch(() => false);
  }
  closeBackendClient();
  if (!backend || !web) throw new Error(`The stack did not come up in time; see ${logPath}.`);
  const head = execFileSync('git', ['log', '--oneline', '-1'], { cwd: repo, encoding: 'utf8' }).trim();
  console.log(`Running ${head} at http://localhost:${port} (log ${logPath}).`);
}

main().catch((error) => {
  closeBackendClient();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
