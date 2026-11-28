import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storageFor } from '@factory/adapters-data';
import { TicketService } from '../src/tickets.ts';
import { ProjectSettings, type TaskManager } from '@factory/core';

test('ticket listing uses the registered repository and configured command, with setup and failure states', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-tickets-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const storage = storageFor(join(base, 'data'));
  await storage.projects.add('app', base);
  let manager: TaskManager = { kind: 'none' };
  let calls = 0;
  let code = 0;
  let stopped: 'timeout' | undefined;
  let stdout = 'APP-1 Fix login\n';
  const service = new TicketService(
    storage.projects,
    async () => ProjectSettings.parse({ task_manager: manager }),
    async (command, options) => {
      calls++;
      assert.equal(command, 'tracker list --project APP');
      assert.equal(options?.cwd, base);
      assert.equal(options?.group, true);
      assert.equal(options?.timeoutMs, 45_000);
      return { code, stdout, stopped, stderr: code ? 'Sign in to tracker' : '' };
    },
  );
  assert.deepEqual(await service.list({ project: 'app' }), { configured: false, text: '' });
  assert.equal(calls, 0);
  manager = { kind: 'jira', list_tickets: 'tracker list --project APP' };
  assert.deepEqual(await service.list({ project: 'app' }), { configured: true, text: 'APP-1 Fix login' });
  // JSON tickets come back parsed too, for the cards.
  stdout = '[{"number":7,"title":"Fix login","labels":[{"name":"bug","color":"d73a4a"}]}]';
  assert.deepEqual((await service.list({ project: 'app' })).tickets, [
    { key: '#7', title: 'Fix login', labels: [{ name: 'bug', color: 'd73a4a' }], assignees: [] },
  ]);
  manager = { kind: 'github', list_tickets: 'tracker list --project APP', project_key: 'acme/app' };
  assert.equal(
    (await service.list({ project: 'app' })).tickets?.[0]?.url,
    'https://github.com/acme/app/issues/7',
    'a GitHub issue links through the project key',
  );
  manager = { kind: 'jira', list_tickets: 'tracker list --project APP' };
  stdout = '';
  assert.deepEqual(await service.list({ project: 'app' }), { configured: true, text: '' });
  stopped = 'timeout';
  await assert.rejects(service.list({ project: 'app' }), /timed out/);
  stopped = undefined;
  code = 1;
  await assert.rejects(service.list({ project: 'app' }), /Sign in to tracker/);
  await assert.rejects(service.list({ project: 'missing' }), /not found/);
  await assert.rejects(service.list({ project: '../app' }));
});
