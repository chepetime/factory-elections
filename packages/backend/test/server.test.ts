// A small real-gRPC smoke suite. Models are scripted; git uses an isolated local repository.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ProjectStore } from '@factory/adapters-fs';
import type { ModelRunner } from '@factory/core';
import { backendCall, closeBackendClient } from '../src/client.ts';
import { startBackend } from '../src/server.ts';

const token = 'factory-test-credential-with-at-least-32-characters';
async function fixture(t: TestContext, runner?: ModelRunner) {
  const base = await mkdtemp(join(tmpdir(), 'factory-server-'));
  const root = join(base, 'data');
  const repo = join(base, 'repo');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  await writeFile(join(repo, 'README.md'), '# test\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  await new ProjectStore(root).add('demo', repo);
  await writeFile(
    join(root, 'demo', 'profile.yaml'),
    `project: demo
approved_at: '2026-11-16'
repo: { base_branch: { value: main, source: test } }
commands: { test: 'test -f feature.txt', full_check: 'true' }
confirmed: { forbidden_paths: [], forbidden_commands: [] }
design_sources: []
qa_targets: []
`,
  );
  const server = await startBackend({
    root,
    port: 0,
    healthPort: 0,
    token,
    runner,
    environment: async () => [{ name: 'Node.js >= 26', ok: true, detail: 'scripted' }],
  });
  const original = {
    address: process.env.FACTORY_BACKEND_ADDRESS,
    token: process.env.FACTORY_BACKEND_TOKEN,
    root: process.env.FACTORY_ROOT,
  };
  process.env.FACTORY_BACKEND_ADDRESS = `127.0.0.1:${server.port}`;
  process.env.FACTORY_BACKEND_TOKEN = token;
  process.env.FACTORY_ROOT = root;
  t.after(async () => {
    closeBackendClient();
    await server.close();
    for (const [key, value] of Object.entries({
      FACTORY_BACKEND_ADDRESS: original.address,
      FACTORY_BACKEND_TOKEN: original.token,
      FACTORY_ROOT: original.root,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(base, { recursive: true, force: true });
  });
  const id = (await backendCall('SubmitTask', { project: 'demo', prompt: 'Add feature.txt' })).text;
  return { root, server, id };
}
async function finished(id: string) {
  for (let i = 0; i < 500; i++) {
    const state = JSON.parse((await backendCall('GetBackground', { project: 'demo', id })).json);
    if (!state.running) return state;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('Run did not complete');
}

test('gRPC authenticates, validates input, reads records and reports health', async (t) => {
  const { server, root, id } = await fixture(t);
  assert.deepEqual(
    JSON.parse((await backendCall('ListProjects', {})).json).map((p: { name: string }) => p.name),
    ['demo'],
  );
  assert.equal(JSON.parse((await backendCall('GetTask', { project: 'demo', id })).json).stage, 'queued');
  await assert.rejects(
    backendCall('GetTask', { project: '../escape', id }),
    (error: unknown) => (error as { code: number }).code === 3,
  );
  process.env.FACTORY_BACKEND_TOKEN = 'wrong-token';
  await assert.rejects(
    backendCall('ListProjects', {}),
    (error: unknown) => (error as { code: number }).code === 16,
  );
  process.env.FACTORY_BACKEND_TOKEN = token;
  assert.equal(
    ((await (await fetch(`http://127.0.0.1:${server.healthPort}/health`)).json()) as { engine: string })
      .engine,
    'running',
  );
  await assert.rejects(startBackend({ root, port: 0, healthPort: 0, token }), /ownership lock/);
});

test('server runs the workflow, retains Effect spans, logs and costs, and enforces approval', async (t) => {
  const runner: ModelRunner = {
    async run(request) {
      if (request.step === 'classifier')
        return {
          text: '',
          costUsd: 0.001,
          structured: {
            intake_id: /"id": "([^"]+)"/.exec(request.prompt)![1],
            kind: 'code',
            loe: 'S',
            readiness: 'ready',
            blockers: [],
          },
        };
      if (request.step === 'coder') {
        await writeFile(join(request.cwd!, 'feature.txt'), 'done\n');
        return { text: 'done', costUsd: 0.1 };
      }
      if (request.step === 'reviewer')
        return {
          text: '',
          costUsd: 0.05,
          structured: { verdict: 'approve', summary: 'Looks right.', findings: [] },
        };
      return {
        text: '',
        costUsd: 0.02,
        structured: { title: 'Add feature file', body: 'Adds the feature.' },
      };
    },
  };
  const { root, server, id } = await fixture(t, runner);
  const accepted = JSON.parse(
    (await backendCall('StartRun', { project: 'demo', id, action: 'run', max_attempts: 1 })).json,
  );
  const outcome = await finished(id);
  assert.equal(outcome.state, 'completed', outcome.error);
  const task = JSON.parse((await backendCall('GetTask', { project: 'demo', id })).json);
  assert.equal(task.stage, 'awaiting-approval');
  assert.equal(task.attempts.length, 4);
  assert.match(outcome.logTail, /Verifying/);
  const dir = join(dirname(server.service.tasks.taskPath('demo', id)), 'runs', accepted.id);
  const events = (await readFile(join(dir, 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const costs = events.filter((e) => e.kind === 'model.cost');
  assert.equal(costs.length, 4);
  assert.ok(Math.abs(costs.reduce((sum, e) => sum + e.cost_usd, 0) - 0.171) < 0.000001);
  const spans = events.filter((e) => e.kind === 'span.start');
  assert.equal(spans.length, 5);
  assert.equal(new Set(spans.map((e) => e.trace_id)).size, 1);
  assert.ok(spans.slice(1).every((e) => e.parent_span_id === spans[0].span_id));
  await assert.rejects(
    backendCall('ExecuteTask', { project: 'demo', id, action: 'approve', head: '0000000' }),
    /--head/,
  );
  const gate = JSON.parse((await backendCall('GetGate', { project: 'demo', id })).json);
  await backendCall('ExecuteTask', { project: 'demo', id, action: 'approve', head: gate.head_sha });
  assert.equal(JSON.parse((await backendCall('GetTask', { project: 'demo', id })).json).stage, 'approved');
  await backendCall('ClearLog', { project: 'demo', id });
  assert.equal(
    JSON.parse((await backendCall('GetBackground', { project: 'demo', id })).json).logTail,
    undefined,
  );
  assert.ok((await readFile(join(dir, 'events.jsonl'), 'utf8')).includes('model.cost'));
  // Existing CLI commands become clients while the backend owns this data root.
  const child = await import('node:child_process');
  const result = await new Promise<{ code: number | null; stderr: string }>((done) => {
    const proc = child.spawn(
      process.execPath,
      [
        new URL('../../../apps/cli/src/main.ts', import.meta.url).pathname,
        'task',
        'reject',
        '--project',
        'demo',
        '--id',
        id,
        '--note',
        'test',
      ],
      { env: process.env },
    );
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('close', (code) => done({ code, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await server.service.tasks.read('demo', id)).stage, 'rejected');
  assert.ok(root);
});

test('duplicate starts are excluded, model failures preserve unknown costs and release ownership', async (t) => {
  let entered!: () => void;
  const enteredPromise = new Promise<void>((done) => {
    entered = done;
  });
  let release!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  t.after(() => release());
  const { server, id } = await fixture(t, {
    async run() {
      entered();
      await hold;
      throw new Error('scripted model failure');
    },
  });
  const accepted = JSON.parse((await backendCall('StartRun', { project: 'demo', id, action: 'run' })).json);
  await enteredPromise;
  await assert.rejects(backendCall('StartRun', { project: 'demo', id, action: 'run' }), /locked/);
  await assert.rejects(
    backendCall('ExecuteTask', { project: 'demo', id, action: 'reject', note: 'no' }),
    /locked/,
  );
  release();
  const result = await finished(id);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /scripted model failure/);
  const dir = join(dirname(server.service.tasks.taskPath('demo', id)), 'runs', accepted.id);
  const events = (await readFile(join(dir, 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(events.find((e) => e.kind === 'model.cost').cost_usd, null);
  assert.ok(events.some((e) => e.kind === 'span.end' && e.outcome === 'failed'));
  assert.equal(await server.service.tasks.withLock('demo', id, async () => 'released'), 'released');
});

test('one worker drains queued runs and a restart reports interrupted evidence without replay', async (t) => {
  let release!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  let calls = 0;
  const runner: ModelRunner = {
    async run(request) {
      calls++;
      await hold;
      return {
        text: '',
        costUsd: null,
        structured: {
          intake_id: /"id": "([^"]+)"/.exec(request.prompt)![1],
          kind: 'code',
          loe: 'S',
          readiness: 'needs-clarification',
          blockers: [{ kind: 'clarification', question: 'Which file?' }],
        },
      };
    },
  };
  t.after(() => release());
  const { server, root, id } = await fixture(t, runner);
  const second = (await backendCall('SubmitTask', { project: 'demo', prompt: 'second task' })).text;
  const firstRun = JSON.parse((await backendCall('StartRun', { project: 'demo', id, action: 'run' })).json);
  await backendCall('StartRun', { project: 'demo', id: second, action: 'run' });
  assert.equal(calls, 1);
  assert.equal(
    JSON.parse((await backendCall('GetBackground', { project: 'demo', id: second })).json).state,
    'queued',
  );
  let stopped = false;
  const closing = server.close().then(() => {
    stopped = true;
  });
  await new Promise((done) => setTimeout(done, 10));
  assert.equal(stopped, false);
  release();
  await closing;
  assert.equal(calls, 2);
  const dir = join(dirname(server.service.tasks.taskPath('demo', id)), 'runs', firstRun.id);
  const record = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'));
  assert.equal(record.state, 'completed');
  // Simulate the on-disk evidence left by an abrupt process exit, then start a fresh service.
  await writeFile(join(dir, 'run.json'), JSON.stringify({ ...record, state: 'running' }));
  const restarted = await startBackend({ root, port: 0, healthPort: 0, token, runner });
  try {
    closeBackendClient();
    process.env.FACTORY_BACKEND_ADDRESS = `127.0.0.1:${restarted.port}`;
    const recovered = JSON.parse((await backendCall('GetBackground', { project: 'demo', id })).json);
    assert.equal(recovered.state, 'interrupted');
    assert.equal(recovered.running, false);
    assert.equal(calls, 2);
  } finally {
    closeBackendClient();
    await restarted.close();
  }
});

test('diagnostics and team reads/assignments are owned by the backend', async (t) => {
  const { root } = await fixture(t);
  const checks = JSON.parse((await backendCall('GetDiagnostics', {})).json);
  assert.equal(checks.data_root, root);
  assert.deepEqual(checks.environment, [{ name: 'Node.js >= 26', ok: true, detail: 'scripted' }]);
  assert.equal(checks.profiles[0].approved, true);
  assert.equal((await backendCall('GetGitUser', { project: 'demo' })).text, 'test');
  const before = JSON.parse((await backendCall('GetTeam', { project: 'demo' })).json);
  assert.equal(before[0].email, 'test@example.com');
  await Promise.all([
    backendCall('SaveAssignment', {
      project: 'demo',
      email: 'TEST@example.com',
      team: ' Platform ',
      tags: [' backend ', 'backend'],
    }),
    backendCall('SaveAssignment', {
      project: 'demo',
      email: 'other@example.com',
      team: 'Tools',
      tags: ['cli'],
    }),
  ]);
  const saved = JSON.parse(await readFile(join(root, 'demo', 'team.json'), 'utf8'));
  assert.deepEqual(saved.members['test@example.com'], { team: 'Platform', tags: ['backend'] });
  assert.equal(saved.members['other@example.com'].team, 'Tools');
  const after = JSON.parse((await backendCall('GetTeam', { project: 'demo' })).json);
  assert.equal(after[0].team, 'Platform');
  await assert.rejects(
    backendCall('SaveAssignment', { project: '../escape', email: 'test@example.com', tags: [] }),
    (error: unknown) => (error as { code: number }).code === 3,
  );
  await writeFile(join(root, 'demo', 'team.json'), 'not JSON');
  await assert.rejects(
    backendCall('SaveAssignment', { project: 'demo', email: 'test@example.com', tags: [] }),
  );
  assert.equal(await readFile(join(root, 'demo', 'team.json'), 'utf8'), 'not JSON');
});
