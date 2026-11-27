// End-to-end workflow: protected paths, the check sandbox, budgets and limits, setup and preflight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as git from '@factory/adapters-git';
import { Driver } from '../src/index.ts';
import {
  approveReview,
  ready,
  setup,
  sh,
  withLimits,
  withProfile,
  withWorktree,
  writeFeature,
  type Script,
} from './workflow-fixture.ts';

test('verification fails a rename out of .github/workflows, with a profile that does not list it', async () => {
  const { driver, task, path, commit } = await withWorktree({ '.github/workflows/ci.yml': 'name: ci\n' });
  sh(path, 'mv', '.github/workflows/ci.yml', 'ci.yml');
  await writeFile(join(path, 'feature.txt'), 'done\n');
  commit('move ci');
  const result = await driver.verify('demo', task.id);
  assert.equal(result.passed, false);
  assert.match(result.output, /protected paths: .*\.github\/workflows\/ci\.yml/);
});

test('verification fails .GitHub/actions and CODEOWNERS in any folder', async () => {
  for (const file of ['.GitHub/actions/x.yml', 'docs/CODEOWNERS', '.husky/pre-push', '.env.local']) {
    const { driver, task, path, commit } = await withWorktree();
    execFileSync('mkdir', ['-p', join(path, file, '..')]);
    await writeFile(join(path, file), 'x\n');
    await writeFile(join(path, 'feature.txt'), 'done\n');
    commit('add protected file');
    const result = await driver.verify('demo', task.id);
    assert.equal(result.passed, false, file);
    assert.ok(result.output.includes(file), `${file}: ${result.output}`);
  }
});

test('a commit the agent made itself, with nothing staged, fails verification on a protected path', async () => {
  const sneaky: Script = async (r) => {
    execFileSync('mkdir', ['-p', join(r.cwd!, '.github', 'actions', 'setup')]);
    await writeFile(join(r.cwd!, '.github', 'actions', 'setup', 'action.yml'), 'runs: {}\n');
    await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
    sh(r.cwd!, 'add', '-A');
    sh(r.cwd!, 'commit', '-qm', 'agent commit');
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task, store } = await setup({ classifier: [ready], coder: [sneaky] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'verification-failed');
  assert.match(stored.verification!.output_tail, /protected paths: \.github\/actions\/setup\/action\.yml/);
});

test('the coder guard refuses built-in protected paths for Edit and Write, in any letter case', async () => {
  let denials: (string | undefined)[] = [];
  const probe: Script = async (r) => {
    denials = [
      r.guard!.check('Write', { file_path: join(r.cwd!, '.github/actions/x/action.yml') }),
      r.guard!.check('Edit', { file_path: join(r.cwd!, '.Husky/pre-push') }),
      r.guard!.check('Write', { file_path: join(r.cwd!, 'docs/CODEOWNERS') }),
      r.guard!.check('Write', { file_path: join(r.cwd!, 'feature.txt') }),
    ];
    return writeFeature(r);
  };
  const { driver, task } = await setup({ classifier: [ready], coder: [probe], reviewer: [approveReview] });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.ok(denials[0] && denials[1] && denials[2]);
  assert.equal(denials[3], undefined);
});

test('a person can allow protected paths for one task; the gate record names them', async () => {
  const { driver, task, store, path, commit } = await withWorktree();
  execFileSync('mkdir', ['-p', join(path, '.github', 'workflows')]);
  await writeFile(join(path, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  await writeFile(join(path, 'feature.txt'), 'done\n');
  commit('add workflow');
  assert.equal((await driver.verify('demo', task.id)).passed, false);
  await store.write({ ...(await store.read('demo', task.id)), allow_protected_paths: true });
  const result = await driver.verify('demo', task.id);
  assert.equal(result.passed, true);
  assert.deepEqual(result.protectedPathsAllowed, ['.github/workflows/ci.yml']);
  assert.match(result.output, /allowed protected paths.*\.github\/workflows\/ci\.yml/);
  // The profile's own forbidden paths stay forbidden.
  execFileSync('mkdir', ['-p', join(path, 'secrets')]);
  await writeFile(join(path, 'secrets', 'k'), 'x');
  commit('add secret');
  assert.match((await driver.verify('demo', task.id)).output, /protected paths: secrets\/k/);
});

test('verification retains only the output tail while forwarding the complete log', async () => {
  const { driver, task } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.classify('demo', task.id);
  await driver.prepareWorktree('demo', task.id);
  let streamed = 0;
  driver.deps.log = (chunk) => {
    streamed += chunk.length;
  };
  driver.deps.shell.runShell = async (_command, options) => {
    assert.equal(options.captureLimit, 0);
    for (let i = 0; i < 1000; i++) options.onOutput?.('x'.repeat(1000));
    options.onOutput?.('failure-end');
    return { code: 1, stdout: '', stderr: '' };
  };
  const result = await driver.verify('demo', task.id);
  assert.equal(result.passed, false);
  assert.ok(streamed > 1_000_000);
  assert.ok(result.output.length <= 6001);
  assert.match(result.output, /failure-end/);
});

test('verification runs every check with the sandboxed environment, never the backend environment', async (t) => {
  process.env.FACTORY_TEST_STORAGE_KEY = 'backend-only-secret';
  t.after(() => void delete process.env.FACTORY_TEST_STORAGE_KEY);
  const { driver, task } = await setup({ classifier: [ready], coder: [writeFeature] });
  await driver.classify('demo', task.id);
  await driver.prepareWorktree('demo', task.id);
  const seen: { command: string; env?: Record<string, string>; sandbox?: unknown; cwd: string }[] = [];
  driver.deps.shell.runShell = async (command, options) => {
    seen.push({ command, cwd: options.cwd, env: options.env, sandbox: options.sandbox });
    return { code: 0, stdout: '', stderr: '' };
  };
  await driver.verify('demo', task.id);
  assert.deepEqual(
    seen.map((s) => s.command),
    ['test -f feature.txt', 'true'],
  );
  for (const call of seen) {
    assert.ok(call.env, 'an explicit environment');
    assert.equal(call.env.FACTORY_TEST_STORAGE_KEY, undefined);
    assert.equal(call.env.PATH, process.env.PATH);
    const sandbox = call.sandbox as { allowWrite: string[]; denyRead: string[]; allowedDomains: string[] };
    assert.ok(sandbox.allowWrite.includes(call.cwd), 'the worktree is writable');
    assert.ok(sandbox.denyRead.some((p) => p.endsWith('/.ssh')));
    assert.deepEqual(sandbox.allowedDomains, ['registry.npmjs.org']);
  }
});

test("setup runs the coder's install scripts in the same sandbox as the checks, never with the backend environment", async (t) => {
  process.env.FACTORY_TEST_STORAGE_KEY = 'backend-only-secret';
  t.after(() => void delete process.env.FACTORY_TEST_STORAGE_KEY);
  const { driver, task } = await setup({ classifier: [ready], coder: [writeFeature] });
  withProfile(driver, (profile) => ({
    ...profile,
    commands: { ...profile.commands, setup: 'pnpm install' },
  }));
  await driver.classify('demo', task.id);
  await driver.prepareWorktree('demo', task.id);
  const seen: { command: string; env?: Record<string, string>; sandbox?: unknown; cwd: string }[] = [];
  driver.deps.shell.runShell = async (command, options) => {
    seen.push({ command, cwd: options.cwd, env: options.env, sandbox: options.sandbox });
    return { code: 0, stdout: '', stderr: '' };
  };
  await driver.setupWorktree('demo', task.id);
  const install = seen.find((s) => s.command === 'pnpm install');
  assert.ok(install, 'setup ran');
  assert.ok(install.env, 'an explicit environment');
  assert.equal(install.env.FACTORY_TEST_STORAGE_KEY, undefined);
  const sandbox = install.sandbox as { allowWrite: string[]; hideRoots: string[]; reopen: string[] };
  assert.ok(sandbox.allowWrite.includes(install.cwd), 'the worktree is writable');
  assert.ok(sandbox.hideRoots.length > 0, 'the factory data root is hidden');
  assert.deepEqual(sandbox.reopen, [install.cwd]);
});

test('running an already reviewed or approved task cannot spend on more model calls', async () => {
  const { driver, task, runner } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const calls = runner.calls.length;
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /cannot be run/);
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /cannot be run/);
  assert.equal(runner.calls.length, calls);
});

test('classification persists the verdict and attempt in one write', async () => {
  const { driver, task, store } = await setup({ classifier: [ready] });
  let writes = 0;
  driver.deps.tasks = {
    read: store.read.bind(store),
    worktreePath: store.worktreePath.bind(store),
    write: async (record) => {
      writes++;
      await store.write(record);
    },
  };
  const classified = await driver.classify('demo', task.id);
  assert.equal(writes, 1);
  assert.equal(classified.verdict?.readiness, 'ready');
  assert.equal(classified.attempts?.[0]?.step, 'classifier');
});

test('verification cannot pass for a commit changed by the check command', async () => {
  const { driver, task, store } = await setup(
    { classifier: [ready], coder: [writeFeature] },
    'test -f feature.txt && git -c user.name=test -c user.email=test@example.com commit --allow-empty -qm changed-during-check',
  );
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'verification-failed');
  assert.equal(stored.verification?.passed, false);
  assert.match(stored.verification!.output_tail, /commit changed during verification/);
});

test('revision preflight failure leaves neither approval nor an approved stage', async () => {
  const { driver, task, runner, store } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  const calls = runner.calls.length;
  const broken = new Driver({
    ...driver.deps,
    readProfile: async () => {
      throw new Error('profile unavailable');
    },
  });
  await assert.rejects(
    broken.revise('demo', task.id, 'change it', { maxAttempts: 1 }),
    /profile unavailable/,
  );
  const failed = await store.read('demo', task.id);
  assert.equal(failed.stage, 'failed');
  assert.equal(failed.approval, undefined);
  assert.equal(runner.calls.length, calls);
  await assert.rejects(driver.openPr('demo', task.id), /approved/);
});

test('every model call gets the step limits, the task budget left and the run signal', async () => {
  const { driver, task, runner } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  const controller = new AbortController();
  driver.deps.signal = controller.signal;
  withLimits(driver, { task_budget_usd: 3 });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  for (const call of runner.calls) {
    assert.equal(call.signal, controller.signal);
    assert.equal(call.timeoutMs, 60 * 60_000);
    assert.equal(call.stallMs, 20 * 60_000);
  }
  // The classifier spent $0.001 of $3, so the coder may spend its own $5 limit only up to what is left.
  assert.equal(runner.calls.find((c) => c.tools === 'edit')?.maxBudgetUsd, 3 - 0.001);
});

test('the ladder stops when the task budget is spent, and says how to continue', async () => {
  const costly: Script = async (r) => (
    await writeFile(join(r.cwd!, 'other.txt'), 'x\n'),
    { text: 'ok', costUsd: 0.5 }
  );
  const { driver, store, task, runner } = await setup({
    classifier: [ready],
    coder: [costly, costly, costly],
  });
  withLimits(driver, { task_budget_usd: 0.6 });
  await assert.rejects(
    driver.run('demo', task.id, { maxAttempts: 3 }),
    /Task budget reached \(\$1\.00 spent\)/,
  );
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 2);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'failed');
  assert.match(stored.events!.at(-1)!.message, /limits\.task_budget_usd/);
});

test('the coder may delegate: it gets a grant for its worktree, and child costs join its attempt', async () => {
  const grants: { label: string; cwd: string; access: string; budgetUsd: number; guard?: unknown }[] = [];
  let revoked = 0;
  const { driver, store, task, runner } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  driver.deps.delegation = {
    grant: (options) => (
      grants.push(options),
      {
        endpoint: { url: 'http://127.0.0.1:1/mcp', token: 't' },
        spent: () => 0.25,
        revoke: () => void revoked++,
      }
    ),
  };
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const coder = runner.calls.find((c) => c.tools === 'edit')!;
  assert.deepEqual(coder.mcp, { url: 'http://127.0.0.1:1/mcp', token: 't' });
  assert.equal(grants.length, 1, 'only the coder may start children');
  assert.equal(grants[0]!.cwd, coder.cwd);
  assert.equal(grants[0]!.access, 'edit');
  assert.equal(grants[0]!.guard, coder.guard, 'children inherit the coder guard');
  assert.equal(revoked, 1);
  const attempt = (await store.read('demo', task.id)).attempts!.find((a) => a.step === 'coder')!;
  assert.equal(attempt.cost_usd, 0.1 + 0.25);
  assert.equal(runner.calls.filter((c) => c.mcp).length, 1);
});

test('tool-using steps get confirmed repository facts, the loop guard and the project context limit', async () => {
  const { driver, task, runner } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  driver.deps.repositoryFacts = async () =>
    '## What earlier sessions learned about this repository\n\n- [f1] Run build first.';
  driver.deps.contextLimits = async () => ({ default: 100_000, 'claude-opus-5-5': 180_000 });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const classifier = runner.calls.find((c) => c.tools === 'none')!;
  assert.doesNotMatch(classifier.systemPrompt, /earlier sessions/, 'a step without tools gets no facts');
  for (const call of runner.calls.filter((c) => c.tools !== 'none')) {
    assert.match(call.systemPrompt, /\[f1\] Run build first\./);
    assert.equal(call.loopGuard, true);
    assert.equal(call.context?.limit, call.model === 'claude-opus-5-5' ? 180_000 : 100_000);
  }
});

test('the setup command runs once per worktree; a failure stops before any model call and a rerun retries it', async () => {
  const withSetup = (driver: Driver, command: string) => {
    const read = driver.deps.readProfile;
    driver.deps.readProfile = async (p) => {
      const profile = await read(p);
      return { ...profile, commands: { ...profile.commands, setup: command } };
    };
  };
  const { driver, task, runner, store } = await setup({
    classifier: [ready, ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  withSetup(driver, 'test -f .ok-to-install && echo installed >> setup.log');
  await assert.rejects(
    driver.run('demo', task.id, { maxAttempts: 1 }),
    /Worktree setup .* exited with status 1/,
  );
  assert.equal(
    runner.calls.filter((c) => c.tools === 'edit').length,
    0,
    'no coder call after a failed setup',
  );
  assert.equal((await store.read('demo', task.id)).stage, 'failed');
  const path = (await store.read('demo', task.id)).worktree!.path;
  // setup.log is untracked output; ignore it so verification stays clean.
  await writeFile(join(path, '.ok-to-install'), '');
  await git.excludeLocally(path, 'setup.log');
  await git.excludeLocally(path, '.ok-to-install');
  const after = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.ok(after.worktree!.setup_at);
  assert.equal(after.stage, 'awaiting-approval');
  assert.equal(
    (await readFile(join(path, 'setup.log'), 'utf8')).trim(),
    'installed',
    'setup ran exactly once',
  );
});

test('a revision after a failed setup runs the setup again before the coder', async () => {
  const { driver, task, runner, store } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  const read = driver.deps.readProfile;
  driver.deps.readProfile = async (p) => {
    const profile = await read(p);
    return {
      ...profile,
      commands: { ...profile.commands, setup: 'test -f .ok-to-install && echo installed >> setup.log' },
    };
  };
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /Worktree setup/);
  await assert.rejects(
    driver.revise('demo', task.id, 'try again', { maxAttempts: 1 }),
    /Worktree setup .* exited with status 1/,
  );
  assert.equal(
    runner.calls.filter((c) => c.tools === 'edit').length,
    0,
    'no coder call while setup still fails',
  );
  const path = (await store.read('demo', task.id)).worktree!.path;
  await writeFile(join(path, '.ok-to-install'), '');
  await git.excludeLocally(path, 'setup.log');
  await git.excludeLocally(path, '.ok-to-install');
  const revised = await driver.revise('demo', task.id, 'try again', { maxAttempts: 1 });
  assert.ok(revised.worktree!.setup_at);
  assert.equal(revised.stage, 'awaiting-approval');
  assert.equal((await readFile(join(path, 'setup.log'), 'utf8')).trim(), 'installed');
});

test('a coder that makes no changes fails with its last message, so the reason is visible', async () => {
  const idle: Script = () => ({
    text: 'I could not update anything: the registry at codeartifact is not reachable from the sandbox.',
    costUsd: 0.3,
  });
  const { driver, task, store } = await setup({ classifier: [ready], coder: [idle] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /coder made no changes/);
  const stored = await store.read('demo', task.id);
  const failed = stored.events!.at(-1)!;
  assert.equal(failed.kind, 'stage:failed');
  assert.equal(failed.message.split('\n')[0], 'coder made no changes');
  assert.match(failed.message, /\nCoder's last message:\n[\s\S]*registry at codeartifact is not reachable/);
  assert.match(stored.attempts!.at(-1)!.error!, /registry at codeartifact is not reachable/);
});

test('a failed preflight check stops a run and a revision before any model call, and names the fix', async () => {
  const { driver, task, runner, store } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  const marker = join(await mkdtemp(join(tmpdir(), 'factory-preflight-')), 'signed-in');
  withProfile(driver, (profile) => ({
    ...profile,
    preflight: [{ name: 'AWS SSO', run: `test -f ${marker}`, fix: `touch ${marker}` }],
  }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /Preflight check "AWS SSO" failed/);
  assert.equal(runner.calls.length, 0, 'no classifier or coder call');
  const failed = await store.read('demo', task.id);
  assert.equal(failed.stage, 'failed');
  assert.equal(failed.worktree, undefined, 'no worktree was created');
  assert.match(failed.events!.at(-1)!.message, new RegExp(`Fix: \`touch ${marker}\``));
  await writeFile(marker, '');
  const done = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(done.stage, 'awaiting-approval');
  await rm(marker);
  await assert.rejects(
    driver.revise('demo', task.id, 'more', { maxAttempts: 1 }),
    /Preflight check "AWS SSO" failed/,
  );
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 1, 'no coder call for the revision');
});

test('an environment failure in verification stops the ladder instead of trying a stronger model', async () => {
  const { driver, task, runner, store } = await setup(
    { classifier: [ready], coder: [writeFeature, writeFeature, writeFeature] },
    "echo 'connect ECONNREFUSED 127.0.0.1:5432' && exit 1",
  );
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 3 }), /environment/);
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 1, 'one coder attempt only');
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'failed');
  const message = stored.events!.at(-1)!.message;
  assert.match(message.split('\n')[0]!, /a network service is not reachable/);
  assert.match(message, /ECONNREFUSED 127\.0\.0\.1:5432/);
});

test('a check that refuses the change as too broad is left to CI, and the task says so', async () => {
  const { driver, task, runner } = await setup(
    { classifier: [ready], coder: [writeFeature], reviewer: [approveReview] },
    "echo 'test:changed: this diff affects 80 workspaces (limit 6), too broad to run on this machine.' && exit 1",
  );
  const reviewed = await driver.run('demo', task.id, { maxAttempts: 3 });
  assert.equal(reviewed.stage, 'awaiting-approval');
  assert.equal(reviewed.verification?.passed, true);
  assert.deepEqual(reviewed.verification?.not_run_locally, ['test']);
  assert.match(
    reviewed.verification!.output_tail,
    /\[test not run locally: .*too broad.* CI must pass before merge\.\]/,
  );
  assert.ok(reviewed.events!.some((e) => /not run locally: test \(CI must pass\)/.test(e.message)));
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 1, 'no second coder attempt');
});

test('a real failure in a later check still fails verification after a too-broad check', async () => {
  const { driver, task } = await setup(
    { classifier: [ready], coder: [writeFeature] },
    "echo 'too broad to run on this machine.' && exit 1",
  );
  withProfile(driver, (profile) => ({
    ...profile,
    commands: { ...profile.commands, full_check: "echo 'lint: 2 errors' && exit 1" },
  }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }));
  const verdict = await driver.verify('demo', task.id);
  assert.equal(verdict.passed, false);
  assert.match(verdict.output, /\[full_check exited with status 1\]/);
});

test('a profile environment pattern also stops the ladder', async () => {
  const { driver, task, runner } = await setup(
    { classifier: [ready], coder: [writeFeature, writeFeature] },
    "echo 'mdm sandbox is down' && exit 1",
  );
  withProfile(driver, (profile) => ({ ...profile, environment_errors: ['sandbox is down'] }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 2 }), /environment/);
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 1);
});
