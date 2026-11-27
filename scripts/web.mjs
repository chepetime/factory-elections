#!/usr/bin/env node
// Starts Next.js and the persistent local backend. Existing authenticated backends can be reused.
import './load-env.ts';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendCall, closeBackendClient } from '../packages/backend-client/src/client.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');
const dev = process.argv.includes('--dev');
process.env.FACTORY_BACKEND_ADDRESS ??= `127.0.0.1:${process.env.FACTORY_BACKEND_PORT ?? 4319}`;
const env = { ...process.env };
// The production build goes through pnpm; the long-running server does not (see below).
if (!dev) {
  console.log('Building the web app…');
  const build = spawnSync('pnpm', ['run', 'build'], { cwd: web, env, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
let backend;
const reachable = async () => {
  try {
    await backendCall('ListProjects', {}, 500);
    return true;
  } catch {
    return false;
  }
};
if (!(await reachable())) {
  backend = spawn(process.execPath, [join(root, 'apps/backend/src/main.ts')], { env, stdio: 'inherit' });
  let exited = false;
  backend.on('exit', () => {
    exited = true;
  });
  backend.on('error', () => {
    exited = true;
  });
  let ready = false;
  for (let i = 0; i < 50 && !exited; i++) {
    if (await reachable()) {
      ready = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!ready) {
    backend.kill('SIGTERM');
    closeBackendClient();
    throw new Error('Backend did not become ready; inspect its startup error above.');
  }
} else if (env.FACTORY_REQUIRE_OWN_BACKEND === '1') {
  closeBackendClient();
  throw new Error('Backend port is already occupied; choose another worktree backend port.');
} else console.log('Using the running local backend.');
closeBackendClient();
// Next runs directly, not through `pnpm run`: no resident pnpm process, no update check, and signals
// and exit codes come straight from Next. Keep these arguments in step with apps/web's scripts.
// Its own process group: `next dev` forks next-server, so stop() signals the whole group.
const nextBin = createRequire(join(web, 'package.json')).resolve('next/dist/bin/next');
const nextArgs = dev ? ['dev', '--webpack', '--hostname', 'localhost'] : ['start', '--hostname', 'localhost'];
const app = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: web,
  env,
  stdio: 'inherit',
  detached: true,
});
console.log(`\nHarbor Lighthouse: http://localhost:${env.PORT ?? 3000}  (Ctrl-C to stop)\n`);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  try {
    process.kill(-app.pid, 'SIGTERM');
  } catch {
    app.kill('SIGTERM'); // the group is gone or never started
  }
  // Only stop a backend owned by this launcher. It drains active runs before exiting.
  backend?.kill('SIGTERM');
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
app.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
  stop();
});
app.on('exit', (code) => {
  process.exitCode = code ?? 0;
  stop();
});
backend?.on('exit', (code) => {
  if (!stopping) {
    process.exitCode = code || 1;
    stop();
  }
});
