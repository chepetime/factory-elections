import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderRouter, type ModelRun } from '@factory/core';
import { DelegationServer, MAX_DELEGATION_DEPTH } from '../src/delegation.ts';

async function rpc(url: string, token: string, method: string, params?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  });
  return {
    status: res.status,
    body: res.status === 200 ? ((await res.json()) as Record<string, any>) : undefined,
  };
}

test('delegate runs a child on any provider within the grant: access, budget, slots and depth', async (t) => {
  const calls: ModelRun[] = [];
  let slots = 1;
  const router = new ProviderRouter({
    claude: { run: async (r) => (calls.push(r), { text: 'claude says hi', costUsd: 0.5 }) },
    codex: { run: async (r) => (calls.push(r), { text: 'codex says hi', costUsd: null }) },
  });
  const server = new DelegationServer({
    runner: router,
    slot: async () => (slots > 0 ? (slots--, () => void slots++) : undefined),
  });
  const url = await server.start();
  t.after(() => server.close());
  const guard = { check: () => undefined };
  const grant = server.grant({ label: 'coder app/t1', cwd: '/work', access: 'edit', budgetUsd: 1, guard })!;
  const token = grant.endpoint.token;

  assert.equal((await rpc(url, 'wrong', 'tools/list')).status, 401);
  const init = await rpc(url, token, 'initialize', { protocolVersion: '2025-06-18' });
  assert.equal(init.body!.result.serverInfo.name, 'factory');
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      })
    ).status,
    202,
  );
  const list = await rpc(url, token, 'tools/list');
  assert.equal(list.body!.result.tools[0].name, 'delegate');
  assert.equal(list.body!.result.tools[0].inputSchema.type, 'object');

  const call = async (args: unknown) =>
    (await rpc(url, token, 'tools/call', { name: 'delegate', arguments: args })).body!.result as {
      content: { text: string }[];
      isError: boolean;
    };

  // A read-only Codex child: no guard (Codex cannot screen calls), its sandbox holds it, and it may delegate further.
  const codex = await call({ provider: 'codex', task: 'Find the config loader' });
  assert.equal(codex.isError, false);
  assert.match(codex.content[0]!.text, /codex says hi/);
  assert.equal(calls[0]!.model, 'codex');
  assert.equal(calls[0]!.tools, 'read-only');
  assert.equal(calls[0]!.guard, undefined);
  assert.equal(calls[0]!.cwd, '/work');
  assert.equal(Boolean(calls[0]!.mcp), MAX_DELEGATION_DEPTH > 1);

  // An editing Codex child would lose the guard, so the router refuses it.
  const refused = await call({ provider: 'codex', task: 'Fix it', access: 'edit' });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0]!.text, /cannot screen each tool call/);

  // A Claude child keeps the guard and spends from the grant.
  const claude = await call({ provider: 'claude', task: 'Fix it', access: 'edit', budget_usd: 5 });
  assert.equal(claude.isError, false);
  assert.equal(calls.at(-1)!.maxBudgetUsd, 1, 'a child gets at most what the grant has left');
  assert.equal(calls.at(-1)!.guard, guard);
  assert.equal(grant.spent(), 0.5);
  assert.equal(slots, 1, 'each child returns its agent slot');

  slots = 0;
  const busy = await call({ provider: 'claude', task: 'More' });
  assert.match(busy.content[0]!.text, /Every agent slot is in use/);

  // A read-only grant cannot start editing children; a revoked grant is refused.
  const reader = server.grant({ label: 'review app#1', cwd: '/r', access: 'read-only', budgetUsd: 1 })!;
  slots = 1;
  const denied = (
    await rpc(url, reader.endpoint.token, 'tools/call', {
      name: 'delegate',
      arguments: { provider: 'claude', task: 'x', access: 'edit' },
    })
  ).body!.result;
  assert.match(denied.content[0].text, /only read-only children/);
  reader.revoke();
  assert.equal((await rpc(url, reader.endpoint.token, 'tools/list')).status, 401);

  // No grants at the depth limit.
  assert.equal(
    server.grant({ label: 'deep', cwd: '/', access: 'read-only', budgetUsd: 1, depth: MAX_DELEGATION_DEPTH }),
    undefined,
  );
});

/** A runner whose child runs until its signal stops it, and reports when it stopped. */
function hangingRunner() {
  let started!: () => void;
  let stopped!: () => void;
  const state = {
    started: new Promise<void>((done) => (started = done)),
    stopped: new Promise<void>((done) => (stopped = done)),
  };
  const runner = {
    run: (r: ModelRun) =>
      new Promise<never>((_, fail) => {
        started();
        r.signal?.addEventListener('abort', () => (stopped(), fail(new Error('aborted'))), { once: true });
      }),
  };
  return { runner, ...state };
}

const within = (p: Promise<void>, ms = 2000) =>
  Promise.race([
    p,
    new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`not within ${ms}ms`)), ms).unref()),
  ]);

test('a delegate call the client stops waiting for stops its child', async (t) => {
  const { runner, started, stopped } = hangingRunner();
  const server = new DelegationServer({ runner, slot: async () => () => {} });
  const url = await server.start();
  t.after(() => server.close());
  const grant = server.grant({ label: 'coder app/t1', cwd: '/work', access: 'edit', budgetUsd: 1 })!;

  const client = new AbortController();
  const call = fetch(url, {
    method: 'POST',
    signal: client.signal,
    headers: { authorization: `Bearer ${grant.endpoint.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'delegate', arguments: { provider: 'claude', task: 'Fix it', access: 'edit' } },
    }),
  }).catch(() => undefined);
  await within(started);
  // Claude Code gives up on a silent tool call: the child must not keep editing the worktree.
  client.abort();
  await call;
  await within(stopped);
});

test('revoking a grant when the parent turn ends stops its running children', async (t) => {
  const { runner, started, stopped } = hangingRunner();
  const server = new DelegationServer({ runner, slot: async () => () => {} });
  const url = await server.start();
  t.after(() => server.close());
  const grant = server.grant({ label: 'coder app/t1', cwd: '/work', access: 'edit', budgetUsd: 1 })!;

  const call = rpc(url, grant.endpoint.token, 'tools/call', {
    name: 'delegate',
    arguments: { provider: 'claude', task: 'Fix it', access: 'edit' },
  }).catch(() => undefined);
  await within(started);
  grant.revoke();
  await within(stopped);
  await call;
});
