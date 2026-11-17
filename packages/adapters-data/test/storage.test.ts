// Real Postgres + S3 checks. Each test owns a temporary schema and unique artifact keys.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import * as files from '@factory/adapters-fs';
import { DataStorage, StorageConfig } from '../src/index.ts';
import { migrateFiles } from '../src/migrate.ts';
import { Evidence } from '../../backend/src/evidence.ts';
import { startBackend } from '../../backend/src/server.ts';
import { backendCall, closeBackendClient } from '../../backend/src/client.ts';

const enabled = !!process.env.FACTORY_TEST_STORAGE;
async function setup(t: TestContext) {
  const config = StorageConfig.parse(JSON.parse(process.env.FACTORY_TEST_STORAGE!));
  const schema = `factory_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: config.databaseUrl });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(config.databaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const isolated = { ...config, databaseUrl: url.toString() };
  const root = await mkdtemp(join(tmpdir(), 'factory-pg-'));
  const storage = new DataStorage(root, isolated);
  await storage.check();
  t.after(async () => {
    const keys = (await storage.pool!.query('SELECT object_key FROM factory_artifacts')).rows;
    if (keys.length)
      for (let i = 0; i < keys.length; i += 1000)
        await storage.s3!.send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: keys.slice(i, i + 1000).map((row) => ({ Key: row.object_key })) },
          }),
        );
    await storage.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  });
  return { storage, root, config: isolated };
}

test(
  'Postgres stores task snapshots and excludes competing command owners',
  { skip: !enabled },
  async (t) => {
    const { storage, root, config } = await setup(t);
    await storage.projects.add('demo', root);
    const task = await storage.tasks.create('demo', root, 'do work', new Date().toISOString());
    assert.equal((await storage.tasks.list('demo')).length, 1);
    const second = new DataStorage(root, config);
    try {
      const release = await storage.tasks.acquireLock('demo', task.id);
      try {
        await assert.rejects(second.tasks.acquireLock('demo', task.id), /locked/);
      } finally {
        await release();
      }
      await second.tasks.withLock('demo', task.id, async () =>
        storage.tasks.write({ ...task, stage: 'failed' }),
      );
      assert.equal((await second.tasks.read('demo', task.id)).stage, 'failed');
      await storage.writeDocuments([
        [join(root, 'run.json'), { state: 'queued' }],
        [join(root, 'latest-run.json'), { id: 'example' }],
      ]);
      assert.deepEqual(await second.readDocument(join(root, 'run.json')), { state: 'queued' });
      await assert.rejects(storage.tasks.read('demo', 'invalid-id'), /UUID/);
      assert.equal(
        await readFile(join(root, 'demo/tasks', task.id, 'task.json'), 'utf8').catch(() => undefined),
        undefined,
      );
    } finally {
      await second.close();
    }
  },
);

test(
  'S3 preserves full logs and binary bytes while Postgres indexes Effect costs',
  { skip: !enabled },
  async (t) => {
    const { storage, root } = await setup(t);
    const id = randomUUID();
    const path = join(root, 'runs', id, 'events.jsonl');
    const evidence = new Evidence(path, id, storage);
    evidence.log('x'.repeat(180_000) + ' final log');
    await evidence.span('task.test', {}, async (span) => {
      await evidence.runner({ run: async () => ({ text: 'ok', costUsd: 0.125 }) }, span).run({
        step: 'classifier',
        tools: 'none',
        model: 'test',
        effort: 'low',
        systemPrompt: '',
        prompt: '',
      });
      const costs = await storage.pool!.query(
        "SELECT data FROM factory_trace_events WHERE run_id=$1 AND kind='model.cost'",
        [id],
      );
      assert.equal(costs.rows[0].data.cost_usd, 0.125);
    });
    await evidence.close();
    assert.ok((await storage.artifactTail(join(dirname(path), 'run.log'), 8000))!.endsWith(' final log\n'));
    const events = await storage.pool!.query(
      'SELECT data FROM factory_trace_events WHERE run_id=$1 AND kind=$2',
      [id, 'log'],
    );
    assert.equal(events.rows[0].data.message, undefined);
    const binary = Buffer.from([0, 255, 128, 13, 10, 42]);
    const image = join(root, 'artifacts', id, 'binary');
    const writer = storage.writer(image);
    writer.append(binary);
    await writer.flush();
    assert.deepEqual(await storage.artifactBytes(image), binary);
  },
);

test(
  'file import verifies data, preserves originals, and activates the host gRPC service',
  { skip: !enabled },
  async (t) => {
    const { storage, root, config } = await setup(t);
    const projects = new files.ProjectStore(root);
    await projects.add('demo', root);
    await writeFile(
      join(root, 'demo/profile.yaml'),
      `project: demo
approved_at: '2026-11-17'
repo: {base_branch: {value: main, source: test}}
commands: {test: 'true', full_check: 'true'}
confirmed: {forbidden_paths: [], forbidden_commands: []}
design_sources: []
qa_targets: []
`,
    );
    const oldTasks = new files.TaskStore(root);
    const task = await oldTasks.create('demo', root, 'do work', new Date().toISOString());
    const path = oldTasks.taskPath('demo', task.id);
    const original = await readFile(path);
    const log = join(dirname(path), 'web-run.log');
    await writeFile(log, 'old log\n');
    const imported = await migrateFiles(root, config);
    assert.equal('tasks' in imported && imported.tasks, 1);
    assert.deepEqual(await readFile(path), original);
    assert.equal(await storage.artifactTail(log), 'old log\n');
    const token = 'temporary-postgres-test-credential-long-enough';
    const server = await startBackend({
      root,
      port: 0,
      healthPort: 0,
      token,
      runner: {
        async run(request) {
          return {
            text: '',
            costUsd: 0.009,
            structured: {
              intake_id: /"id": "([^"]+)"/.exec(request.prompt)![1],
              kind: 'code',
              loe: 'S',
              readiness: 'needs-clarification',
              blockers: [{ kind: 'clarification', question: 'Which file?' }],
            },
          };
        },
      },
    });
    process.env.FACTORY_BACKEND_ADDRESS = `127.0.0.1:${server.port}`;
    process.env.FACTORY_BACKEND_TOKEN = token;
    try {
      const accepted = JSON.parse(
        (await backendCall('StartRun', { project: 'demo', id: task.id, action: 'run' })).json,
      );
      let outcome;
      for (let i = 0; i < 300; i++) {
        outcome = JSON.parse((await backendCall('GetBackground', { project: 'demo', id: task.id })).json);
        if (!outcome.running) break;
        await new Promise((done) => setTimeout(done, 10));
      }
      assert.equal(outcome.state, 'completed', outcome.error);
      const updated = JSON.parse((await backendCall('GetTask', { project: 'demo', id: task.id })).json);
      assert.equal(updated.stage, 'blocked');
      assert.equal(updated.attempts[0].cost_usd, 0.009);
      assert.deepEqual(await readFile(path), original);
      assert.equal(
        (
          await storage.pool!.query(
            "SELECT count(*) AS n FROM factory_trace_events WHERE run_id=$1 AND kind='model.cost'",
            [accepted.id],
          )
        ).rows[0].n,
        '1',
      );
      assert.deepEqual(await migrateFiles(root, config), { alreadyActive: true });
    } finally {
      closeBackendClient();
      await server.close();
      delete process.env.FACTORY_BACKEND_ADDRESS;
      delete process.env.FACTORY_BACKEND_TOKEN;
    }
  },
);

test(
  'the complete coding workflow uses Postgres/S3 and preserves exact-head approval',
  { skip: !enabled },
  async (t) => {
    const { storage, root, config } = await setup(t);
    const repo = join(root, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.com');
    await writeFile(join(repo, 'README.md'), '# test\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    await storage.projects.add('demo', repo);
    await files.writeProfileDraft(
      root,
      'demo',
      `project: demo
approved_at: '2026-11-17'
repo: {base_branch: {value: main, source: test}}
commands: {test: 'test -f feature.txt', full_check: 'true'}
confirmed: {forbidden_paths: [], forbidden_commands: []}
design_sources: []
qa_targets: []
`,
    );
    await writeFile(join(root, 'storage.json'), JSON.stringify(config), { mode: 0o600 });
    const task = await storage.tasks.create('demo', repo, 'Add feature.txt', new Date().toISOString());
    const server = await startBackend({
      root,
      port: 0,
      healthPort: 0,
      token: 'temporary-full-workflow-credential-32-chars',
      runner: {
        async run(request) {
          if (request.step === 'classifier')
            return {
              text: '',
              costUsd: 0.001,
              structured: { intake_id: task.id, kind: 'code', loe: 'S', readiness: 'ready', blockers: [] },
            };
          if (request.step === 'coder') {
            await writeFile(join(request.cwd!, 'feature.txt'), 'done\n');
            return { text: 'done', costUsd: 0.1 };
          }
          if (request.step === 'reviewer')
            return {
              text: '',
              costUsd: 0.05,
              structured: { verdict: 'approve', summary: 'Looks right', findings: [] },
            };
          return {
            text: '',
            costUsd: 0.02,
            structured: { title: 'Add feature file', body: 'Adds the feature.' },
          };
        },
      },
    });
    try {
      const accepted = await server.service.start({
        project: 'demo',
        id: task.id,
        action: 'run',
        max_attempts: 1,
      });
      let state;
      for (let i = 0; i < 500; i++) {
        state = await server.service.background({ project: 'demo', id: task.id });
        if (!state.running) break;
        await new Promise((done) => setTimeout(done, 10));
      }
      assert.equal(state!.state, 'completed', state!.error ?? 'Run did not complete');
      const gate = await server.service.driver().gate('demo', task.id);
      assert.equal(gate.task.stage, 'awaiting-approval');
      assert.equal(gate.task.attempts?.length, 4);
      await assert.rejects(
        server.service.execute({ project: 'demo', id: task.id, action: 'approve', head: '0000000' }),
        /--head/,
      );
      await server.service.execute({ project: 'demo', id: task.id, action: 'approve', head: gate.headSha });
      assert.equal((await storage.tasks.read('demo', task.id)).approval?.head_sha, gate.headSha);
      const costs = await storage.pool!.query(
        "SELECT sum((data->>'cost_usd')::numeric) AS total,count(*) AS n FROM factory_trace_events WHERE run_id=$1 AND kind='model.cost'",
        [accepted.id],
      );
      assert.equal(costs.rows[0].n, '4');
      assert.ok(Math.abs(Number(costs.rows[0].total) - 0.171) < 0.000001);
    } finally {
      await server.close();
    }
  },
);
