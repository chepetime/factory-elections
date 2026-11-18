// End-to-end flows against the production web build and a seeded backend.
//
// The backend runs in this process on a temporary data root, with a scripted model runner, so a
// task really goes classify → code → verify → review → gate without paid calls. The web app runs
// as `next start` against it, and Chromium drives the pages. Run with `pnpm e2e`; set
// E2E_SKIP_BUILD=1 to reuse an existing `.next` build.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startBackend } from '@factory/backend';
import { backendCall, closeBackendClient } from '@factory/backend/client';
import type { ModelRunner } from '@factory/core';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const token = 'e2e-token-0123456789abcdef0123456789';

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
    return { text: '', costUsd: 0.02, structured: { title: 'Add feature file', body: 'Adds the feature.' } };
  },
};

const freePort = () =>
  new Promise<number>((done) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => done(port));
    });
  });

let base: string;
let server: Awaited<ReturnType<typeof startBackend>>;
let next: ChildProcess;
let browser: Browser;
let url: string;
let taskId: string;

async function waitFor<T>(what: string, check: () => Promise<T | undefined>, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'factory-e2e-'));
  const root = join(base, 'data');
  const repo = join(base, 'repo');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.name', 'E2E Tester');
  git('config', 'user.email', 'e2e@example.com');
  await writeFile(join(repo, 'README.md'), '# demo\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  await mkdir(root, { recursive: true });
  server = await startBackend({
    root,
    port: 0,
    healthPort: 0,
    token,
    runner,
    environment: async () => [{ name: 'Node.js >= 26', ok: true, detail: 'e2e' }],
  });
  process.env.FACTORY_BACKEND_ADDRESS = `127.0.0.1:${server.port}`;
  process.env.FACTORY_BACKEND_TOKEN = token;
  process.env.FACTORY_ROOT = root;
  await backendCall('AddProject', { name: 'demo', repo });
  await writeFile(
    join(root, 'demo', 'profile.yaml'),
    `project: demo
approved_at: '2026-11-18'
repo: { base_branch: { value: main, source: e2e } }
commands: { test: 'test -f feature.txt', full_check: 'true' }
confirmed: { forbidden_paths: [], forbidden_commands: [] }
design_sources: []
qa_targets: []
`,
  );

  // Seed: one task through the workflow to the approval gate.
  taskId = (await backendCall('SubmitTask', { project: 'demo', prompt: 'Add the feature file' })).text;
  await backendCall('StartRun', { project: 'demo', id: taskId, action: 'run', max_attempts: 1 } as never);
  await waitFor('the approval gate', async () => {
    const task = JSON.parse((await backendCall('GetTask', { project: 'demo', id: taskId })).json);
    return task.stage === 'awaiting-approval' ? true : undefined;
  });

  if (!process.env.E2E_SKIP_BUILD) {
    const build = spawnSync('pnpm', ['run', 'build'], { cwd: web, stdio: 'inherit' });
    assert.equal(build.status, 0, 'the web build succeeds');
  }
  const port = await freePort();
  url = `http://localhost:${port}`;
  next = spawn('pnpm', ['exec', 'next', 'start', '--hostname', 'localhost', '-p', String(port)], {
    cwd: web,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  await waitFor('the web server', async () => ((await fetch(url)).status < 500 ? true : undefined), 90_000);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (next?.pid) process.kill(-next.pid, 'SIGTERM');
  closeBackendClient();
  await server?.close();
  await rm(base, { recursive: true, force: true });
});

async function page(path: string): Promise<Page> {
  const p = await browser.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const res = await p.goto(`${url}${path}`);
  assert.ok(res && res.status() < 400, `${path} loads (${res?.status()})`);
  assert.deepEqual(errors, [], `${path} has no page errors`);
  return p;
}

test('the task list shows the seeded task at the approval gate', async () => {
  const p = await page('/projects/demo/tasks');
  await p.getByRole('heading', { name: 'Tasks: demo' }).waitFor();
  await p.getByRole('link', { name: 'Add the feature file' }).waitFor();
  await p.close();
});

test('the approval gate approves exactly the reviewed commit', async () => {
  const gate = JSON.parse((await backendCall('GetGate', { project: 'demo', id: taskId })).json);
  const p = await page(`/projects/demo/tasks/${taskId}`);
  await p.getByText('Waiting for your decision').waitFor();
  await p.getByRole('button', { name: `Approve ${gate.head_sha.slice(0, 12)}` }).click();
  await waitFor('the approval', async () => {
    const task = JSON.parse((await backendCall('GetTask', { project: 'demo', id: taskId })).json);
    return task.stage === 'approved' ? true : undefined;
  });
  // The gate wait is in the trace, and the inbox is empty again.
  const metrics = JSON.parse((await backendCall('GetMetrics', { project: 'demo', json: '{}' })).json);
  assert.equal(metrics.gates.count, 1);
  assert.equal(JSON.parse((await backendCall('GetInbox', {})).json).items.length, 0);
  await p.close();
});

test('project settings show the task manager and the list-tickets command', async () => {
  await backendCall('SaveProjectSettings', {
    project: 'demo',
    json: JSON.stringify({
      task_manager: { kind: 'jira', cli: 'acli', list_tickets: 'acli jira workitem search' },
    }),
  });
  const p = await page('/projects/demo/settings');
  await p.getByText('List tickets').first().waitFor();
  assert.ok((await p.content()).includes('acli jira workitem search'), 'the saved command is shown');
  await p.close();
});
