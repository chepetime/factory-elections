import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TaskStore } from '../src/index.ts';

const CLI = resolve(import.meta.dirname, '../../../apps/cli/src/main.ts');

test('task lock excludes other processes, permits reads, and releases after errors', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new TaskStore(root);
  const task = await store.create('demo', root, 'do work', new Date().toISOString());
  await assert.rejects(
    store.withLock('demo', task.id, async () => {
      assert.equal((await store.read('demo', task.id)).id, task.id);
      await assert.rejects(
        new TaskStore(root).withLock('demo', task.id, async () => {}),
        /locked/,
      );
      const child = spawn(process.execPath, [CLI, 'task', 'classify', '--project', 'demo', '--id', task.id], {
        env: { ...process.env, FACTORY_ROOT: root },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      const code = await new Promise((done, reject) => {
        child.on('error', reject);
        child.on('close', done);
      });
      assert.equal(code, 1);
      assert.match(stderr, /task is locked/);
      throw new Error('operation failed');
    }),
    /operation failed/,
  );
  assert.equal(await store.withLock('demo', task.id, async () => 'released'), 'released');
});
