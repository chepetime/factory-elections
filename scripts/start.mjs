#!/usr/bin/env node
// One command from a cold machine to a running app: clears a backend lock left by a reboot,
// starts the Docker data services when storage is configured, then runs scripts/web.mjs.
// Pass --dev to start Next.js in dev mode. Other arguments go to web.mjs unchanged.
import './load-env.ts';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { uptime } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataRoot } from '../packages/adapters-fs/src/index.ts';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dataRoot();

// The backend writes <root>/backend.lock and refuses to start while it exists. Remove it only when
// it predates the last boot: then its backend and every worker it spawned are certainly gone.
// A lock from this boot with a dead PID can still have orphaned workers, so a person decides.
function clearStaleLock() {
  const lock = join(root, 'backend.lock');
  if (!existsSync(lock)) return;
  let pid;
  try {
    pid = JSON.parse(readFileSync(lock, 'utf8')).pid;
  } catch {
    pid = undefined;
  }
  if (Number.isInteger(pid) && alive(pid)) return; // A running backend; web.mjs reuses it.
  const bootedAt = Date.now() - uptime() * 1000;
  if (statSync(lock).mtimeMs < bootedAt) {
    rmSync(lock);
    console.log(`Removed backend lock from before the last boot (pid ${pid ?? 'unknown'}).`);
    return;
  }
  throw new Error(
    `Backend lock ${lock} names a stopped process (pid ${pid ?? 'unknown'}) from this boot. ` +
      'Confirm its workers stopped, remove the lock, then run this again.',
  );
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const dockerUp = () => spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

async function startDocker() {
  if (dockerUp()) return;
  if (process.platform !== 'darwin') throw new Error('Docker is not running. Start it, then run this again.');
  const app = ['OrbStack', 'Docker'].find((name) => spawnSync('open', ['-a', name]).status === 0);
  if (!app)
    throw new Error('Docker is not running, and neither OrbStack nor Docker Desktop could be opened.');
  console.log(`Starting ${app}…`);
  for (let i = 0; i < 120; i++) {
    if (dockerUp()) return;
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`${app} did not start within 120 s.`);
}

function run(script, args) {
  const result = spawnSync(process.execPath, [join(repo, 'scripts', script), ...args], {
    cwd: repo,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

clearStaleLock();
// Without storage.json the backend uses file mode and needs no data services.
if (existsSync(join(root, 'storage.json'))) {
  // data.mjs up generates new credentials when this file is missing, and Compose then recreates the
  // shared containers with them. Only the checkout that created the services may start them.
  if (!existsSync(join(repo, '.factory-data.env')))
    throw new Error(
      `Storage is configured in ${root}, but this checkout has no .factory-data.env. ` +
        'Run this from the checkout that owns the data services.',
    );
  await startDocker();
  run('data.mjs', ['up']);
}

const web = spawn(process.execPath, [join(repo, 'scripts', 'web.mjs'), ...process.argv.slice(2)], {
  cwd: repo,
  stdio: 'inherit',
});
// Ctrl-C already reaches web.mjs through the process group; stay alive while it drains.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => web.kill('SIGTERM'));
web.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
