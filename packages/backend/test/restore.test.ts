// A file-mode installation restored from its documented backup set (docs/storage-ownership.md):
// every durable entity comes back, links resolve, and receipt signatures still verify.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { ProjectStore } from '@factory/adapters-fs';
import { storageFor } from '@factory/adapters-data';
import { MemoryService } from '@factory/agents';
import { saveTaskReceipt, verifyTaskReceipt } from '@factory/evidence';
import { AgentPool, Executions } from '@factory/dispatcher';
import { ProjectSettings } from '@factory/core';
import { FeatureService } from '../src/features.ts';

/** Files under FACTORY_ROOT that belong to a running backend, not to the backup. */
const RUNTIME_ONLY = new Set(['backend.lock', 'backend-token', 'command.lock']);

async function installation(root: string, repo: string) {
  const projects = new ProjectStore(root);
  await projects.add('app', repo);
  await writeFile(
    join(root, 'app', 'profile.yaml'),
    `project: app
approved_at: '2026-11-26'
repo: { base_branch: { value: main, source: test } }
commands: { test: 'true', full_check: 'true' }
confirmed: { forbidden_paths: [], forbidden_commands: [] }
design_sources: []
qa_targets: []
`,
  );
  const storage = storageFor(root);
  const features = new FeatureService({
    root,
    projects,
    runner: () => ({ run: async () => ({ text: '', costUsd: 0 }) }),
    executions: new Executions({ pool: new AgentPool({ max: 1 }) }),
    settings: async () => ProjectSettings.parse({}),
    facts: async () => undefined,
    tasks: storage.tasks,
    startRun: async () => undefined,
  });
  const memory = new MemoryService(root, () => ({ run: async () => ({ text: '', costUsd: 0 }) }));
  return { projects, storage, features, memory };
}

test('a copy of the documented backup set restores tasks, features, memory and verifiable receipts', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-restore-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  const source = join(base, 'source');
  const before = await installation(source, repo);
  const task = await before.storage.tasks.create('app', repo, 'Add a staging link', new Date().toISOString());
  const head = 'a'.repeat(40);
  await before.storage.tasks.write({
    ...task,
    verification: { passed: true, head_sha: head, at: task.created_at!, output_tail: 'ok' },
  });
  await saveTaskReceipt(source, before.storage, 'app', task.id, head);
  const feature = await before.features.create({ project: 'app', idea: 'Staging links everywhere' });
  await before.memory.recordTools('app', ['Read', 'Bash'], ['Read']);
  await writeFile(join(source, 'backend.lock'), '{"pid":1}\n');

  const restore = async (target: string, skip: (name: string) => boolean = () => false) => {
    await cp(source, target, {
      recursive: true,
      filter: (path) => !RUNTIME_ONLY.has(basename(path)) && !skip(basename(path)),
    });
    return installation2(target);
  };
  const installation2 = async (root: string) => {
    const projects = new ProjectStore(root);
    const storage = storageFor(root);
    return {
      projects,
      storage,
      features: new FeatureService({
        root,
        projects,
        runner: () => ({ run: async () => ({ text: '', costUsd: 0 }) }),
        executions: new Executions({ pool: new AgentPool({ max: 1 }) }),
        settings: async () => ProjectSettings.parse({}),
        facts: async () => undefined,
        tasks: storage.tasks,
        startRun: async () => undefined,
      }),
      memory: new MemoryService(root, () => ({ run: async () => ({ text: '', costUsd: 0 }) })),
    };
  };

  const target = join(base, 'restored');
  const after = await restore(target);
  assert.deepEqual(
    (await after.projects.list()).map((p) => [p.name, p.repo]),
    [['app', repo]],
  );
  const restored = await after.storage.tasks.read('app', task.id);
  assert.equal(restored.prompt, 'Add a staging link');
  assert.equal(restored.repo, repo, 'the task still points at its repository');
  assert.equal((await after.features.read('app', feature.id)).title, feature.title);
  assert.deepEqual((await after.memory.toolUsage('app')).known.sort(), ['Bash', 'Read']);
  const check = await verifyTaskReceipt(target, after.storage, 'app', task.id, { currentHead: head });
  assert.equal(check.ok, true, check.lines.join('\n'));

  // Without the receipt key, a restored receipt cannot be trusted: the key belongs in the backup.
  const keyless = await restore(join(base, 'keyless'), (name) => name === 'receipt-key');
  const untrusted = await verifyTaskReceipt(join(base, 'keyless'), keyless.storage, 'app', task.id, {
    currentHead: head,
  });
  assert.equal(untrusted.ok, false);
});
