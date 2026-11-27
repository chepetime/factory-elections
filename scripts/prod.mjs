#!/usr/bin/env node
// The whole production start in one command: install the locked dependencies, then run
// scripts/start.mjs without --dev (stale lock, data services, web build, backend, `next start`),
// and report "ready" only once the web app and the backend health check both answer.
// Usage: pnpm prod [-- --no-install] [-- --from-agent-session]
// PORT and FACTORY_HEALTH_PORT move the checked URLs, as they move the servers.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
// pnpm forwards the `--` separator itself; drop it.
const args = process.argv.slice(2).filter((a) => a !== '--');
const fail = (message) => {
  console.error(`prod: ${message}`);
  process.exit(1);
};

const major = Number(process.versions.node.split('.')[0]);
if (major < 26) fail(`Node.js 26 or later is required; found ${process.version}.`);

// `next start` can bind ::1 beside another server on 127.0.0.1, and the readiness check below would
// then report the other server as ready. Refuse a taken port instead.
const web = `http://localhost:${process.env.PORT ?? 3000}`;
const taken = await fetch(web, { signal: AbortSignal.timeout(2000) }).then(
  () => true,
  () => false,
);
if (taken) fail(`${web} already answers. Stop that server (pnpm run restart for the factory) or set PORT.`);

if (!args.includes('--no-install')) {
  console.log('==> Installing dependencies (pnpm install --frozen-lockfile)');
  const install = spawnSync('pnpm', ['install', '--frozen-lockfile'], { cwd: repo, stdio: 'inherit' });
  if (install.error) fail('pnpm was not found.');
  if (install.status !== 0) fail('pnpm install failed; see the output above.');
}

console.log('==> Building and starting production mode');
const start = spawn(
  process.execPath,
  [join(repo, 'scripts', 'start.mjs'), ...args.filter((a) => a !== '--no-install')],
  { cwd: repo, stdio: 'inherit' },
);
// Ctrl-C reaches start.mjs through the process group; stay alive while it drains.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => start.kill('SIGTERM'));
let exited = false;
start.on('exit', (code, signal) => {
  exited = true;
  process.exit(code ?? (signal ? 1 : 0));
});

const health = `http://127.0.0.1:${process.env.FACTORY_HEALTH_PORT ?? 4318}/health`;
const answers = async (url, accept) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return accept(response.status, await response.text());
  } catch {
    return false;
  }
};
// A cold build takes about 15 s and the data services up to 2 min; after 10 min report it and
// leave the servers running.
const deadline = Date.now() + 10 * 60_000;
while (!exited && Date.now() < deadline) {
  const ready =
    (await answers(health, (status, body) => status === 200 && body.includes('"running"'))) &&
    (await answers(web, (status) => status < 400));
  if (ready) {
    console.log(`\n==> Ready: ${web}  (backend health ${health}; Ctrl-C to stop)\n`);
    break;
  }
  await new Promise((done) => setTimeout(done, 2000));
}
if (!exited && Date.now() >= deadline)
  console.error(`prod: ${web} or ${health} did not answer within 10 minutes; check the output above.`);
