#!/usr/bin/env node
// Starts the local web app on http://localhost:3000 together with the engine health server
// (factory serve, 127.0.0.1:4318). Builds the app first unless --dev is given. Ctrl-C stops both.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');
const dev = process.argv.includes('--dev');
const env = { ...process.env, FACTORY_CLI_SCRIPT: join(root, 'bin', 'factory') };

if (!dev) {
  console.log('Building the web app…');
  const build = spawnSync('pnpm', ['run', 'build'], { cwd: web, env, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const children = [];
const health = spawn(process.execPath, [join(root, 'bin', 'factory'), 'serve'], {
  env,
  stdio: ['ignore', 'inherit', 'pipe'],
});
health.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  if (text.includes('EADDRINUSE'))
    console.log('Engine health server already running on 127.0.0.1:4318; using it.');
  else process.stderr.write(text);
});
children.push(health);

const app = spawn('pnpm', ['run', dev ? 'dev' : 'start'], { cwd: web, env, stdio: 'inherit' });
children.push(app);
console.log('\nSoftware Factory: http://localhost:3000  (Ctrl-C to stop)\n');

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
app.on('exit', (code) => {
  stop();
  process.exit(code ?? 0);
});
