import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./worktree.mjs', import.meta.url));
test('isolated launch refuses an occupied health port before starting services', async () => {
  const servers = [];
  try {
    for (let i = 0; i < 3; i++) {
      const server = createServer();
      await new Promise((done) => server.listen(0, done));
      servers.push(server);
    }
    const ports = servers.map((server) => server.address().port);
    await Promise.all(servers.slice(0, 2).map((server) => new Promise((done) => server.close(done))));
    const result = spawnSync(process.execPath, [script, 'run', ...ports.map(String)], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EADDRINUSE/);
  } finally {
    for (const server of servers) if (server.listening) await new Promise((done) => server.close(done));
  }
});
test('worktrees isolate dirty source, preserve ignored files, and keep branches on removal', () => {
  const parent = mkdtempSync(join(tmpdir(), 'factory-worktree-'));
  const main = join(parent, 'repo');
  const git = (...args) =>
    execFileSync('git', args, { cwd: main, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', main]);
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: main, encoding: 'utf8' });
  try {
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(main, 'source'), 'committed');
    writeFileSync(join(main, '.gitignore'), '.env\n');
    git('add', '.');
    git('commit', '-m', 'initial');
    writeFileSync(join(main, 'source'), 'dirty');
    writeFileSync(join(main, '.env'), 'SECRET=source');
    const created = run('new', 'feature/test');
    assert.equal(created.status, 0, created.stderr);
    const target = created.stdout.trim();
    assert.ok(target.endsWith('--feature-test'), target);
    assert.equal(readFileSync(join(target, 'source'), 'utf8'), 'committed');
    assert.equal(existsSync(join(target, '.env')), false);
    assert.equal(run('new', 'feature/test').status, 1);
    writeFileSync(join(target, '.env'), 'SECRET=target');
    assert.equal(run('remove', 'feature/test').status, 1);
    assert.equal(existsSync(target), true);
    rmSync(join(target, '.env'));
    assert.equal(run('remove', 'feature/test').status, 0);
    assert.equal(existsSync(target), false);
    git('show-ref', '--verify', 'refs/heads/feature/test');
    assert.equal(readFileSync(join(main, 'source'), 'utf8'), 'dirty');
    assert.equal(run('run', '3000', '3000').status, 1);
    assert.equal(run('run', '3000', '65535').status, 1);
    assert.equal(run('run', '4321', '4320').status, 1);
    assert.equal(run('run', '3000', '4320', '3000').status, 1);
    assert.equal(run('new', '--force').status, 1);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
