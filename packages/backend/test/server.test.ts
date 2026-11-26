// A small real-gRPC smoke suite. Models are scripted; git uses an isolated local repository.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ProjectStore } from '@factory/adapters-fs';
import { TaskControls, type ModelRunner } from '@factory/core';
import { backendCall, closeBackendClient } from '@factory/backend-client';
import { Evidence } from '../src/evidence.ts';
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
  const id = (
    await backendCall('SubmitTask', { project: 'demo', prompt: 'Add feature.txt', jiraKey: 'DEMO-42' })
  ).text;
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
  const controls = TaskControls.parse(
    JSON.parse((await backendCall('GetTaskControls', { project: 'demo', id })).json),
  );
  const cli = await promisify(execFile)(
    process.execPath,
    [
      fileURLToPath(new URL('../../../apps/cli/src/main.ts', import.meta.url)),
      'task',
      'actions',
      '--project',
      'demo',
      '--id',
      id,
    ],
    { env: process.env },
  );
  assert.deepEqual(TaskControls.parse(JSON.parse(cli.stdout)), controls);
  assert.equal(controls.execution, 'idle');
  assert.equal(controls.actions.find((a) => a.action === 'run')?.allowed, true);
  assert.equal(controls.actions.find((a) => a.action === 'revise')?.blockers[0]?.code, 'worktree-required');
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
        request.onEvent?.({ type: 'text', text: 'Adding the feature file.' });
        request.onEvent?.({ type: 'tool', name: 'Write', input: { file_path: 'feature.txt' }, callId: 'w1' });
        request.onEvent?.({ type: 'tool-result', ok: true, text: 'written', callId: 'w1' });
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
  // The run's session log survives the run: the coder's message, tool call and result, in order.
  const session = JSON.parse((await backendCall('GetRunSession', { project: 'demo', id })).json);
  assert.equal(session.live, false);
  assert.deepEqual(
    session.entries.map((e: { kind: string }) => e.kind),
    ['run', 'text', 'tool', 'result'],
  );
  assert.equal(session.entries[2].input, 'feature.txt');
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
  const inbox = JSON.parse((await backendCall('GetInbox', {})).json);
  assert.deepEqual(
    inbox.items.map((i: { kind: string; task_id: string }) => [i.kind, i.task_id]),
    [['gate', id]],
  );
  const gate = JSON.parse((await backendCall('GetGate', { project: 'demo', id })).json);
  await backendCall('ExecuteTask', { project: 'demo', id, action: 'approve', head: gate.head_sha });
  assert.equal(JSON.parse((await backendCall('GetTask', { project: 'demo', id })).json).stage, 'approved');
  // The span ledger: one run span with the day-one fields, its model calls under it, and the gate.
  const ledger = await server.service.traces.read('demo', { task_id: id });
  const run = ledger.find((s) => s.type === 'run')!;
  assert.equal(run.task_class, 'code/S');
  assert.equal(task.jira_key, 'DEMO-42');
  assert.deepEqual(run.ticket, { key: 'DEMO-42' });
  assert.equal(run.replay!.prompt, task.prompt);
  assert.match(run.replay!.base_sha!, /^[0-9a-f]{40}$/);
  assert.ok(run.replay!.verification.length > 0);
  const models = ledger.filter((s) => s.type === 'model');
  assert.deepEqual(
    models.map((s) => s.step),
    ['classifier', 'coder', 'reviewer', 'pr-writer'],
  );
  assert.ok(models.every((s) => s.parent_span_id === run.span_id && s.trace_id === run.trace_id));
  assert.deepEqual(
    models.map((s) => s.task_class ?? null),
    [null, 'code/S', 'code/S', 'code/S'],
    'spans after classification carry the task class',
  );
  assert.ok(Math.abs(models.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0) - 0.171) < 0.000001);
  const gateSpan = ledger.find((s) => s.type === 'gate')!;
  assert.equal(gateSpan.attributes!.decision, 'approved');
  assert.ok(gateSpan.duration_ms! >= 0);
  const tree = JSON.parse(
    (await backendCall('GetTrace', { project: 'demo', json: JSON.stringify({ task_id: id }) })).json,
  );
  const runNode = tree.roots.find((r: { span: { type: string } }) => r.span.type === 'run');
  assert.equal(runNode.children.length, 4);
  assert.ok(Math.abs(runNode.total.cost_usd - 0.171) < 0.000001);
  const metrics = JSON.parse((await backendCall('GetMetrics', { project: '', json: '{}' })).json);
  assert.deepEqual([metrics.runs.count, metrics.runs.first_pass_rate, metrics.gates.count], [1, 1, 1]);
  assert.equal(
    JSON.parse((await backendCall('GetInbox', {})).json).items.length,
    0,
    'the gate left the inbox',
  );
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
        fileURLToPath(new URL('../../../apps/cli/src/main.ts', import.meta.url)),
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
  const controls = TaskControls.parse(
    JSON.parse((await backendCall('GetTaskControls', { project: 'demo', id })).json),
  );
  assert.equal(controls.execution, 'running');
  assert.ok(controls.actions.every((a) => !a.allowed && a.blockers[0]?.code === 'busy'));
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

test('shutdown finishes the active run, keeps queued runs for the next start, and a restart settles both', async (t) => {
  process.env.FACTORY_TASK_WORKERS = '1';
  t.after(() => delete process.env.FACTORY_TASK_WORKERS);
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
  for (let i = 0; i < 200 && calls < 1; i++) await new Promise((done) => setTimeout(done, 10));
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
  // The second run never started, so it stays queued instead of running during shutdown.
  assert.equal(calls, 1);
  const dir = join(dirname(server.service.tasks.taskPath('demo', id)), 'runs', firstRun.id);
  const record = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'));
  assert.equal(record.state, 'completed');
  assert.equal(record.outcome, 'completed');
  assert.deepEqual(record.cleanup, { status: 'clean' });
  // Simulate the on-disk evidence left by an abrupt process exit, then start a fresh service.
  await writeFile(join(dir, 'run.json'), JSON.stringify({ ...record, state: 'running' }));
  const restarted = await startBackend({ root, port: 0, healthPort: 0, token, runner });
  try {
    closeBackendClient();
    process.env.FACTORY_BACKEND_ADDRESS = `127.0.0.1:${restarted.port}`;
    const recovered = JSON.parse((await backendCall('GetBackground', { project: 'demo', id })).json);
    assert.equal(recovered.state, 'interrupted');
    assert.equal(recovered.phase, 'interrupted');
    assert.equal(recovered.running, false);
    assert.match(recovered.error, /backend stopped during this run/);
    const settled = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'));
    assert.equal(settled.outcome, 'interrupted');
    assert.equal(settled.cleanup.status, 'uncertain', 'a crash does not prove the processes stopped');
    // The run that never started is queued again and runs now.
    for (let i = 0; i < 200 && calls < 2; i++) await new Promise((done) => setTimeout(done, 10));
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

test('a terminal workflow stays busy until evidence closes; failed finalization is never completed', async (t) => {
  let release!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  let entered!: () => void;
  const closing = new Promise<void>((done) => {
    entered = done;
  });
  t.after(() => release());
  const originalClose = Evidence.prototype.close;
  t.mock.method(Evidence.prototype, 'close', async function (this: Evidence) {
    if (this.path.endsWith('/events.jsonl')) {
      entered();
      await hold;
      await originalClose.call(this);
      throw new Error('scripted evidence failure');
    }
    await originalClose.call(this);
  });
  const { id } = await fixture(t, {
    async run(request) {
      return {
        text: '',
        costUsd: 0,
        structured: {
          intake_id: /"id": "([^"]+)"/.exec(request.prompt)![1],
          kind: 'code',
          loe: 'S',
          readiness: 'needs-clarification',
          blockers: [{ kind: 'clarification', question: 'Which file?' }],
        },
      };
    },
  });
  await backendCall('StartRun', { project: 'demo', id, action: 'run' });
  await closing;
  const pending = JSON.parse((await backendCall('GetBackground', { project: 'demo', id })).json);
  assert.equal(pending.state, 'completed');
  assert.equal(pending.running, true);
  assert.equal(pending.phase, 'finalizing');
  const controls = TaskControls.parse(
    JSON.parse((await backendCall('GetTaskControls', { project: 'demo', id })).json),
  );
  assert.equal(controls.execution, 'finalizing');
  assert.ok(controls.actions.every((a) => !a.allowed));
  await assert.rejects(backendCall('StartRun', { project: 'demo', id, action: 'run' }), /locked/);
  release();
  const failed = await finished(id);
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /finalization failed: scripted evidence failure/);
});

test('invalid persisted execution metadata fails closed in action discovery', async (t) => {
  const { server, id } = await fixture(t);
  const runId = '11111111-2222-4333-8444-555555555555';
  const taskDir = dirname(server.service.tasks.taskPath('demo', id));
  await server.service.storage.writeDocuments([
    [join(taskDir, 'latest-run.json'), { id: runId }],
    [
      join(taskDir, 'runs', runId, 'run.json'),
      { id: runId, project: 'demo', task_id: id, state: 'invented' },
    ],
  ]);
  const controls = TaskControls.parse(
    JSON.parse((await backendCall('GetTaskControls', { project: 'demo', id })).json),
  );
  assert.equal(controls.execution, 'unavailable');
  assert.ok(controls.actions.every((a) => !a.allowed && a.blockers[0]?.code === 'unavailable'));
});

test('AddProject registers a repository and rejects invalid or duplicate registrations', async (t) => {
  const { root } = await fixture(t);
  const repo = await mkdtemp(join(tmpdir(), 'factory-added-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const added = JSON.parse((await backendCall('AddProject', { name: 'second', repo })).json);
  const { profile, ...project } = added;
  assert.deepEqual(project, { name: 'second', repo });
  assert.equal(profile.status, 'drafted', 'adding a project drafts its profile');
  assert.match(profile.path, /second\/profile\.yaml$/);
  assert.deepEqual(
    JSON.parse((await backendCall('ListProjects', {})).json).map((p: { name: string }) => p.name),
    ['demo', 'second'],
  );
  assert.equal(JSON.parse(await readFile(join(root, 'second', 'project.json'), 'utf8')).repo, repo);
  await assert.rejects(backendCall('AddProject', { name: 'second', repo }), /already exists/);
  await assert.rejects(
    backendCall('AddProject', { name: '../escape', repo }),
    (error: unknown) => (error as { code: number }).code === 3,
  );
  await assert.rejects(backendCall('AddProject', { name: 'relative', repo: 'some/dir' }), /must be absolute/);
  await assert.rejects(
    backendCall('AddProject', { name: 'missing', repo: join(repo, 'nope') }),
    /not an existing directory/,
  );
});

test('shutdown stops a run that outlasts the grace period, and records why', async (t) => {
  let signals = 0;
  const runner: ModelRunner = {
    run: (request) =>
      new Promise((_, fail) => {
        if (request.signal) signals++;
        request.signal?.addEventListener('abort', () =>
          fail(
            Object.assign(new Error('model run stopped: the backend is shutting down'), { kind: 'aborted' }),
          ),
        );
      }),
  };
  const { server, root, id } = await fixture(t, runner);
  const run = JSON.parse((await backendCall('StartRun', { project: 'demo', id, action: 'run' })).json);
  for (let i = 0; i < 200 && signals === 0; i++) await new Promise((done) => setTimeout(done, 10));
  assert.equal(signals, 1);
  const started = Date.now();
  await server.service.drain(50);
  assert.ok(Date.now() - started < 5000);
  const dir = join(dirname(server.service.tasks.taskPath('demo', id)), 'runs', run.id);
  const record = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'));
  assert.equal(record.state, 'failed');
  assert.match(record.error, /shutting down/);
  assert.ok(root);
});

test('task runs execute in parallel, up to the worker count', async (t) => {
  let release!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  let running = 0;
  let peak = 0;
  const runner: ModelRunner = {
    async run(request) {
      peak = Math.max(peak, ++running);
      await hold;
      running--;
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
  process.env.FACTORY_TASK_WORKERS = '2';
  t.after(() => delete process.env.FACTORY_TASK_WORKERS);
  const { id } = await fixture(t, runner);
  const ids = [id];
  for (const prompt of ['second', 'third'])
    ids.push((await backendCall('SubmitTask', { project: 'demo', prompt })).text);
  for (const task of ids) await backendCall('StartRun', { project: 'demo', id: task, action: 'run' });
  for (let i = 0; i < 200 && running < 2; i++) await new Promise((done) => setTimeout(done, 10));
  assert.equal(running, 2);
  const third = JSON.parse((await backendCall('GetBackground', { project: 'demo', id: ids[2] })).json);
  assert.equal(third.state, 'queued');
  release();
  for (const task of ids) assert.equal((await finished(task)).state, 'completed');
  assert.equal(peak, 2);
});

test('StopRun aborts the active run, and the task says you stopped it', async (t) => {
  let signals = 0;
  const runner: ModelRunner = {
    run: (request) =>
      new Promise((_, fail) => {
        if (request.signal) signals++;
        request.signal?.addEventListener('abort', () =>
          fail(Object.assign(new Error('model run stopped: aborted'), { kind: 'aborted' })),
        );
      }),
  };
  const { server, id } = await fixture(t, runner);
  await assert.rejects(backendCall('StopRun', { project: 'demo', id }), /No run is active/);
  const run = JSON.parse((await backendCall('StartRun', { project: 'demo', id, action: 'run' })).json);
  for (let i = 0; i < 200 && signals === 0; i++) await new Promise((done) => setTimeout(done, 10));
  assert.equal(signals, 1);
  const live = JSON.parse((await backendCall('GetBackground', { project: 'demo', id })).json);
  assert.ok(live.activity.run_started_at, 'a running run reports its activity');
  assert.ok(live.activity.last_output_at, 'log lines count as output');
  assert.match((await backendCall('StopRun', { project: 'demo', id })).text, /Stopping/);
  for (
    let i = 0;
    i < 200 && JSON.parse((await backendCall('GetBackground', { project: 'demo', id })).json).running;
    i++
  )
    await new Promise((done) => setTimeout(done, 10));
  const dir = join(dirname(server.service.tasks.taskPath('demo', id)), 'runs', run.id);
  const record = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'));
  assert.equal(record.state, 'failed');
  assert.equal(record.outcome, 'cancelled', 'a stop is a cancellation, not a failure');
  assert.deepEqual(record.cleanup, { status: 'clean' });
  assert.match(record.error, /Stopped by you/);
  const task = await server.service.tasks.read('demo', id);
  assert.equal(task.stage, 'failed');
  assert.match(task.events!.at(-1)!.message, /Stopped by you/);
});

test('a stopped call that cannot vouch for its processes leaves the run cleanup uncertain', async (t) => {
  let signals = 0;
  const runner: ModelRunner = {
    run: (request) =>
      new Promise((_, fail) => {
        if (request.signal) signals++;
        request.signal?.addEventListener('abort', () =>
          fail(
            Object.assign(new Error('model run stopped: aborted'), {
              kind: 'aborted',
              cleanup: { status: 'uncertain', reason: 'the shell command may still run' },
            }),
          ),
        );
      }),
  };
  const { server, id } = await fixture(t, runner);
  const run = JSON.parse((await backendCall('StartRun', { project: 'demo', id, action: 'run' })).json);
  for (let i = 0; i < 200 && signals === 0; i++) await new Promise((done) => setTimeout(done, 10));
  await backendCall('StopRun', { project: 'demo', id });
  for (
    let i = 0;
    i < 200 && JSON.parse((await backendCall('GetBackground', { project: 'demo', id })).json).running;
    i++
  )
    await new Promise((done) => setTimeout(done, 10));
  const dir = join(dirname(server.service.tasks.taskPath('demo', id)), 'runs', run.id);
  const record = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'));
  assert.equal(record.outcome, 'cancelled');
  assert.deepEqual(record.cleanup, { status: 'uncertain', reasons: ['the shell command may still run'] });

  // The next run waits until a person confirms that nothing from this one still runs.
  const controls = JSON.parse((await backendCall('GetTaskControls', { project: 'demo', id })).json);
  const run_ = controls.actions.find((a: { action: string }) => a.action === 'run');
  assert.equal(run_.allowed, false);
  assert.equal(run_.blockers.at(-1).code, 'cleanup');
  await assert.rejects(
    backendCall('StartRun', { project: 'demo', id, action: 'run' }),
    /may have left processes running \(the shell command may still run\)/,
  );
  assert.match((await backendCall('ConfirmCleanup', { project: 'demo', id })).text, /confirmed/);
  await assert.rejects(backendCall('ConfirmCleanup', { project: 'demo', id }), /no uncertain cleanup/);
  const confirmed = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'));
  assert.equal(confirmed.cleanup.status, 'uncertain', 'the reasons stay on the record');
  assert.ok(confirmed.cleanup.confirmed_at);
  const after = JSON.parse((await backendCall('GetTaskControls', { project: 'demo', id })).json);
  assert.equal(after.actions.find((a: { action: string }) => a.action === 'run').allowed, true);
});

test('a profile check runs in the background and keeps its last result', async (t) => {
  const { server } = await fixture(t, { run: async () => assert.fail('no model call') });
  const started = JSON.parse((await backendCall('StartProfileCheck', { project: 'demo', id: '' })).json);
  assert.equal(started.running, true);
  let state = started;
  for (let i = 0; i < 300 && state.running; i++) {
    await new Promise((done) => setTimeout(done, 20));
    state = JSON.parse((await backendCall('GetProfileCheck', { project: 'demo', id: '' })).json);
  }
  assert.equal(state.running, false);
  assert.equal(state.passed, false, 'the fixture test command fails on the base branch');
  assert.deepEqual(
    state.steps.map((s: { name: string; outcome: string }) => [s.name, s.outcome]),
    [
      ['Worktree from main', 'passed'],
      ['Test', 'failed'],
      ['Full check', 'skipped'],
    ],
  );
  assert.ok(state.finished_at);
  await server.service.drain(10);
});

test('an agent start that cannot run is refused in plain words and leaves no empty run', async (t) => {
  const { root } = await fixture(t);
  const call = async (method: 'CreateIssue' | 'UpdateIssue' | 'MoveIssue' | 'GetIssue', body: object) =>
    JSON.parse((await backendCall(method, { project: 'demo', json: JSON.stringify(body) })).json);
  // The fixture's SubmitTask run is task DEM-1; this is DEM-2.
  const created = await call('CreateIssue', { title: 'Add a staging link', status: 'todo' });
  await call('UpdateIssue', { key: created.key, assignee: 'devin' });
  const profile = join(root, 'demo', 'profile.yaml');
  const approved = await readFile(profile, 'utf8');

  await writeFile(profile, approved.replace("approved_at: '2026-11-16'", "approved_at: ''"));
  await assert.rejects(
    call('MoveIssue', { key: created.key, to: 'in_progress' }),
    /repo profile is not approved/,
  );
  assert.deepEqual((await call('GetIssue', { key: created.key })).runs, [], 'no run was created');

  await writeFile(profile, approved);
});

test('a queued run cancelled before it starts leaves the queue at once, frees its lock and never runs', async (t) => {
  process.env.FACTORY_TASK_WORKERS = '1';
  t.after(() => delete process.env.FACTORY_TASK_WORKERS);
  let release!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  let calls = 0;
  const runner: ModelRunner = {
    async run() {
      calls++;
      await hold;
      throw Object.assign(new Error('scripted end'), { kind: 'aborted' });
    },
  };
  t.after(() => release());
  const { server, id } = await fixture(t, runner);
  const second = (await backendCall('SubmitTask', { project: 'demo', prompt: 'second task' })).text;
  const third = (await backendCall('SubmitTask', { project: 'demo', prompt: 'third task' })).text;
  await backendCall('StartRun', { project: 'demo', id, action: 'run' });
  const queued = JSON.parse(
    (await backendCall('StartRun', { project: 'demo', id: second, action: 'run' })).json,
  );
  const stoppedRun = JSON.parse(
    (await backendCall('StartRun', { project: 'demo', id: third, action: 'run' })).json,
  );
  for (let i = 0; i < 200 && calls < 1; i++) await new Promise((done) => setTimeout(done, 10));
  assert.equal(server.service.isWaiting('demo', second), 'slot', 'a busy worker is a slot wait');
  const stageBefore = (await server.service.tasks.read('demo', second)).stage;

  // The worker is still busy, so this only returns because the run left the queue.
  await server.service.cancelQueued('demo', second);
  assert.equal(server.service.isWaiting('demo', second), undefined);
  const unlock = await server.service.tasks.acquireLock('demo', second);
  await unlock();
  // StopRun on a queued run takes the same way out.
  assert.match((await backendCall('StopRun', { project: 'demo', id: third })).text, /before it starts/);
  await finished(third);

  for (const [task, run] of [
    [second, queued.id],
    [third, stoppedRun.id],
  ]) {
    const dir = join(dirname(server.service.tasks.taskPath('demo', task)), 'runs', run);
    const record = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'));
    assert.equal(record.state, 'failed');
    assert.equal(record.outcome, 'cancelled');
    assert.match(record.error, /before the run started/);
  }
  assert.equal(
    (await server.service.tasks.read('demo', second)).stage,
    stageBefore,
    'the task keeps its stage',
  );
  release();
  await finished(id);
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(calls, 1, 'the cancelled runs never reached the model');
});

test('a turn behind its busy agent says so, and a cancel takes it out of the wait at once', async (t) => {
  let release!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  let calls = 0;
  const runner: ModelRunner = {
    async run() {
      calls++;
      await hold;
      throw Object.assign(new Error('scripted end'), { kind: 'aborted' });
    },
  };
  t.after(() => release());
  const { server } = await fixture(t, runner);
  const call = async (method: 'CreateIssue' | 'UpdateIssue' | 'MoveIssue' | 'GetIssue', body: object) =>
    JSON.parse((await backendCall(method, { project: 'demo', json: JSON.stringify(body) })).json);
  await server.service.agents.update({ id: 'devin', concurrency: 1, auto_pickup: false });
  const keys: string[] = [];
  for (const title of ['First for Devin', 'Second for Devin']) {
    const created = await call('CreateIssue', { title, status: 'todo' });
    await call('UpdateIssue', { key: created.key, assignee: 'devin' });
    await call('MoveIssue', { key: created.key, to: 'in_progress' });
    keys.push(created.key);
  }
  for (let i = 0; i < 300 && calls < 1; i++) await new Promise((done) => setTimeout(done, 10));
  assert.equal(calls, 1);
  const second = await call('GetIssue', { key: keys[1] });
  assert.equal(second.run.waiting, true);
  assert.equal(second.run.waiting_for, 'agent', 'it waits for Devin, not for a free slot');

  const started = Date.now();
  await call('MoveIssue', { key: keys[1], to: 'cancelled' });
  assert.ok(Date.now() - started < 1000, `the cancel did not wait for the poll (${Date.now() - started} ms)`);
  const cancelled = await call('GetIssue', { key: keys[1] });
  assert.equal(cancelled.run.waiting, undefined);
  assert.equal(cancelled.run.stage, 'rejected');
  release();
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(calls, 1, 'the cancelled turn never reached the model');
});
