// Spawns the real `factory` executable against a temporary data root. No model, GitHub or network calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pnpmCheck } from '../src/doctor.ts';

const BIN = resolve(import.meta.dirname, '..', '..', '..', 'bin', 'factory');
const DEFS = resolve(import.meta.dirname, '..', '..', '..', 'definitions');

async function env() {
  const base = await mkdtemp(join(tmpdir(), 'factory-cli-'));
  const repo = join(base, 'repo');
  spawnSync('git', ['init', '-q', '-b', 'main', repo]);
  return { root: join(base, 'data'), repo, base };
}

function factory(root: string, ...args: string[]) {
  const r = spawnSync(BIN, args, { encoding: 'utf8', env: { ...process.env, FACTORY_ROOT: root } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('help', () => {
  const r = factory('/nonexistent', '--help');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Usage: factory \[options\]/);
});

test('intake, show and list', async () => {
  const { root, repo } = await env();
  const r = factory(root, 'intake', '--project', 'demo', '--repo', repo, '  Fix the  bug ');
  assert.equal(r.code, 0, r.stderr);
  const id = r.stdout.trim();
  assert.match(id, /^[0-9a-f-]{36}$/);
  const task = JSON.parse(await readFile(join(root, 'demo', 'tasks', id, 'task.json'), 'utf8'));
  assert.equal(task.stage, 'queued');
  assert.equal(task.prompt, '  Fix the  bug ');
  assert.deepEqual(JSON.parse(factory(root, 'task', 'show', '--project', 'demo', '--id', id).stdout).id, id);
  assert.equal(JSON.parse(factory(root, 'task', 'list', '--project', 'demo').stdout).length, 1);
  assert.deepEqual(JSON.parse(factory(root, 'task', 'list', '--project', 'other').stdout), []);
  assert.notEqual(factory(root, 'intake', '--project', 'bad name', '--repo', repo, 'x').code, 0);
  assert.notEqual(factory(root, 'intake', '--project', 'demo', '--repo', 'relative', 'x').code, 0);
  assert.notEqual(factory(root, 'intake', '--project', 'demo', '--repo', repo, '   ').code, 0);
  assert.notEqual(
    factory(root, 'task', 'show', '--project', 'demo', '--id', '00000000-0000-4000-8000-000000000000').code,
    0,
  );
});

test('projects: add, duplicate, list and intake without --repo', async () => {
  const { root, repo } = await env();
  assert.deepEqual(JSON.parse(factory(root, 'project', 'list').stdout), []);
  assert.equal(
    factory(root, 'project', 'add', '--name', 'demo', '--repo', repo).stdout,
    'Project added: demo\n',
  );
  assert.equal(factory(root, 'project', 'add', '--name', 'demo', '--repo', repo).code, 1);
  assert.deepEqual(JSON.parse(factory(root, 'project', 'list').stdout), [{ name: 'demo', repo }]);
  assert.equal(factory(root, 'intake', '--project', 'demo', 'Do it').code, 0);
});

test('project add drafts an unapproved profile that check rejects until approved', async () => {
  const { root, repo } = await env();
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify({ scripts: { test: 'node --test', lint: 'oxlint' } }),
  );
  const added = factory(root, 'project', 'add', '--name', 'demo', '--repo', repo);
  assert.equal(added.code, 0, added.stderr);
  assert.match(added.stderr, /Profile drafted: .*demo\/profile\.yaml/);
  const init = factory(root, 'profile', 'init', '--project', 'demo');
  assert.equal(init.code, 0, init.stderr);
  assert.match(init.stderr, /already exists/);
  const path = init.stdout.trim();
  const draft = await readFile(path, 'utf8');
  assert.match(draft, /npm install --no-package-lock && npm run test/);
  assert.notEqual(factory(root, 'profile', 'check', '--project', 'demo').code, 0);
  const approved = draft.replace('approved_at: ""', 'approved_at: "2026-11-13"');
  await writeFile(path, approved);
  assert.equal(factory(root, 'profile', 'check', '--project', 'demo').stdout, 'Profile valid: demo\n');
  assert.equal(factory(root, 'profile', 'init', '--project', 'demo').code, 0);
  assert.equal(await readFile(path, 'utf8'), approved, 'init never replaces a profile');
});

test('shipped definitions are valid', () => {
  for (const s of ['classifier', 'coder', 'reviewer']) {
    assert.equal(
      factory('/x', 'definition', 'check-step', join(DEFS, 'steps', `${s}.yaml`)).stdout,
      `Step valid: ${s}\n`,
    );
    assert.equal(
      factory('/x', 'definition', 'check-ladder', join(DEFS, 'ladders', `${s}.yaml`)).stdout,
      `Ladder valid: ${s}\n`,
    );
  }
  assert.equal(
    factory('/x', 'definition', 'check-loop', join(DEFS, 'loops', 'code.yaml')).stdout,
    'Loop valid: code\n',
  );
});

test('verdict check and record-verdict', async () => {
  const { root, repo, base } = await env();
  const id = factory(root, 'intake', '--project', 'demo', '--repo', repo, 'x').stdout.trim();
  const good = join(base, 'v.json');
  await writeFile(
    good,
    JSON.stringify({ intake_id: id, kind: 'code', loe: 'S', readiness: 'ready', blockers: [] }),
  );
  assert.equal(factory(root, 'verdict', 'check', good).stdout, `Verdict valid: ${id}\n`);
  const bad = join(base, 'bad.json');
  await writeFile(
    bad,
    JSON.stringify({ intake_id: id, kind: 'code', loe: 'S', readiness: 'needs-research', blockers: [] }),
  );
  const r = factory(root, 'verdict', 'check', bad);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.equal(
    factory(root, 'task', 'record-verdict', '--project', 'demo', '--id', id, '--verdict', good).stdout,
    `Verdict recorded: ${id}\n`,
  );
  assert.deepEqual(JSON.parse(factory(root, 'task', 'readiness', '--project', 'demo', '--id', id).stdout), {
    action: 'continue',
  });
});

test('doctor pnpm check reports the version or an install hint', async () => {
  const found = await pnpmCheck(async () => ({ code: 0, stdout: '12.18.0\n' }));
  assert.equal(found.ok, true);
  assert.equal(found.detail, '12.18.0');
  const missing = await pnpmCheck(async () => ({ code: 127, stdout: '' }));
  assert.equal(missing.ok, false);
  assert.match(missing.fix ?? '', /brew install pnpm/);
});

test('serve starts the full backend and reports health on 127.0.0.1', async () => {
  const { root } = await env();
  const child = spawn(BIN, ['serve', '--port', '43187'], {
    env: { ...process.env, FACTORY_ROOT: root, FACTORY_BACKEND_PORT: '43189' },
  });
  try {
    await new Promise<void>((ok, reject) => {
      const timer = setTimeout(() => reject(new Error('Backend readiness timeout')), 5000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Backend exited ${code}`));
      });
      child.stderr.on('data', (d: Buffer) => {
        if (d.toString().includes('Factory backend:')) {
          clearTimeout(timer);
          ok();
        }
      });
    });
    const body = await (await fetch('http://127.0.0.1:43187/health')).json();
    assert.deepEqual(body, {
      engine: 'running',
      task_store: 'available',
      telemetry_database: 'not_configured',
      integrations: [],
      ledger: { missing_parent_links: 0, unknown_cost_spans: 0, write_errors: 0 },
    });
  } finally {
    const exited = new Promise((done) => child.once('exit', done));
    child.kill('SIGTERM');
    await exited;
  }
});

test('setup links factory into the bin directory and is safe to rerun', async () => {
  const { base } = await env();
  const binDir = join(base, 'bin');
  const script = resolve(import.meta.dirname, '..', '..', '..', 'scripts', 'setup.mjs');
  const run = () =>
    spawnSync(process.execPath, [script, '--no-install', '--no-doctor'], {
      encoding: 'utf8',
      env: { ...process.env, FACTORY_BIN_DIR: binDir },
    });
  for (const r of [run(), run()]) {
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /is not on your PATH/);
  }
  const linked = spawnSync(join(binDir, 'factory'), ['--help'], { encoding: 'utf8' });
  assert.match(linked.stdout, /^Usage: factory/);
  // Replace the link itself (writing through it would overwrite bin/factory).
  await rm(join(binDir, 'factory'));
  await writeFile(join(binDir, 'factory'), 'not a link');
  const refused = spawnSync(process.execPath, [script, '--no-install', '--no-doctor'], {
    encoding: 'utf8',
    env: { ...process.env, FACTORY_BIN_DIR: binDir },
  });
  assert.equal(refused.status, 1);
});

test('receipt issue signs what the task proves; verify catches an edit', async () => {
  const { root, repo } = await env();
  const id = factory(root, 'intake', '--project', 'demo', '--repo', repo, 'Fix it').stdout.trim();
  const path = join(root, 'demo', 'tasks', id, 'task.json');
  const head = 'c'.repeat(40);
  const task = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(
    path,
    JSON.stringify({
      ...task,
      verification: {
        passed: true,
        head_sha: head,
        at: task.created_at,
        output_tail: '',
        test_integrity: 'checked',
      },
    }),
  );
  assert.equal(factory(root, 'receipt', 'verify', '--project', 'demo', '--id', id).code, 1, 'no receipt yet');
  const issued = factory(root, 'receipt', 'issue', '--project', 'demo', '--id', id);
  assert.equal(issued.code, 0, issued.stderr);
  assert.match(issued.stdout, /\*\*PROVEN\*\* The test and full-check commands pass/);
  assert.match(issued.stdout, /\*\*NOT PROVEN\*\* A person approved this exact commit/);
  const ok = factory(root, 'receipt', 'verify', '--project', 'demo', '--id', id);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  const receiptPath = join(root, 'demo', 'tasks', id, 'receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  receipt.claims.find((c: { id: string }) => c.id === 'approved').status = 'proven';
  await writeFile(receiptPath, JSON.stringify(receipt));
  const edited = factory(root, 'receipt', 'verify', '--project', 'demo', '--id', id);
  assert.equal(edited.code, 1);
  assert.match(edited.stdout, /FAIL {2}digest/);
});
