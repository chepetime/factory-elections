// End-to-end workflow: setup reruns, registry tokens, profile checks, stacked tasks, resume and opening the PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Driver } from '../src/index.ts';
import {
  approveReview,
  ready,
  setup,
  sh,
  withLimits,
  withProfile,
  writeFeature,
  writeOther,
  type Script,
} from './workflow-fixture.ts';

test('setup runs again when the coder changes a lockfile, and a failed rerun goes back to the coder', async () => {
  const logDir = await mkdtemp(join(tmpdir(), 'factory-setup-'));
  const log = join(logDir, 'setup.log');
  const brokenLock: Script = async (r) => {
    await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
    await writeFile(join(r.cwd!, 'pnpm-lock.yaml'), 'broken\n');
    return { text: 'ok', costUsd: 0.1 };
  };
  let feedback = '';
  const fixedLock: Script = async (r) => {
    feedback = r.prompt;
    await writeFile(join(r.cwd!, 'pnpm-lock.yaml'), 'lockfileVersion: valid\n');
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task } = await setup({
    classifier: [ready],
    coder: [brokenLock, fixedLock],
    reviewer: [approveReview],
  });
  withProfile(driver, (profile) => ({
    ...profile,
    commands: {
      ...profile.commands,
      setup: `echo run >> ${log} && { test ! -f pnpm-lock.yaml || grep -q valid pnpm-lock.yaml; }`,
    },
  }));
  const done = await driver.run('demo', task.id, { maxAttempts: 2 });
  assert.equal(done.stage, 'awaiting-approval');
  assert.match(feedback, /setup/i, 'the failed setup output reached the next coder attempt');
  assert.equal(
    (await readFile(log, 'utf8')).trim().split('\n').length,
    3,
    'setup ran for the new worktree, then after each lockfile change',
  );
  assert.ok(done.worktree!.setup_key, 'the setup inputs are recorded');
});

test('the coder gets a short-lived registry token in its own npmrc and the profile env, never in the log', async () => {
  let seen: { env?: Record<string, string>; npmrc?: string } = {};
  const probe: Script = async (r) => {
    seen = { env: r.env, npmrc: await readFile(r.env!.NPM_CONFIG_USERCONFIG!, 'utf8') };
    return writeFeature(r);
  };
  const { driver, task, store } = await setup({
    classifier: [ready],
    coder: [probe],
    reviewer: [approveReview],
  });
  const lines: string[] = [];
  driver.deps.log = (line) => void lines.push(line);
  withProfile(driver, (profile) => ({
    ...profile,
    sandbox: {
      allowed_domains: ['registry.example.test'],
      env: { CODEARTIFACT_TOKEN_STAGED: '1' },
      npm_tokens: [{ registry: '//registry.example.test/npm/mdm/', command: 'echo tok-123' }],
    },
  }));
  await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(seen.env!.CODEARTIFACT_TOKEN_STAGED, '1');
  assert.equal(seen.npmrc, '//registry.example.test/npm/mdm/:_authToken=tok-123\n');
  assert.equal(existsSync(seen.env!.NPM_CONFIG_USERCONFIG!), false, 'the npmrc is removed after the call');
  const stored = JSON.stringify(await store.read('demo', task.id));
  assert.ok(
    !stored.includes('tok-123') && !lines.join('\n').includes('tok-123'),
    'the token is never recorded',
  );
});

test('a registry token that cannot be minted fails the task before the coder, as an environment fault', async () => {
  const { driver, task, runner, store } = await setup({ classifier: [ready], coder: [writeFeature] });
  withProfile(driver, (profile) => ({
    ...profile,
    sandbox: {
      npm_tokens: [
        {
          registry: '//registry.example.test/npm/mdm/',
          command: "echo 'Error when retrieving token from sso: Token has expired' >&2; exit 255",
        },
      ],
    },
  }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /registry token/);
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 0);
  const failed = (await store.read('demo', task.id)).events!.at(-1)!;
  assert.equal(failed.kind, 'stage:failed');
  assert.match(failed.message, /\/\/registry\.example\.test\/npm\/mdm\//);
  assert.match(failed.message, /Token has expired/);
});

test('a setup or check that prints nothing for the stall limit is stopped and says so', async () => {
  const { driver, task, runner, store } = await setup(
    { classifier: [ready], coder: [writeFeature] },
    'echo testing; sleep 30',
  );
  withProfile(driver, (profile) => ({
    ...profile,
    commands: { ...profile.commands, setup: 'echo installing; sleep 30' },
    limits: { ...profile.limits, check_stall_minutes: 0.01 },
  }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /printed nothing for 1 second/);
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 0);
  assert.match((await store.read('demo', task.id)).events!.at(-1)!.message, /installing/);
  withProfile(driver, (profile) => ({ ...profile, commands: { ...profile.commands, setup: 'true' } }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }));
  assert.match(
    (await store.read('demo', task.id)).verification!.output_tail,
    /\[test printed nothing for 1 second and was stopped\]/,
  );
});

test('the profile check runs preflight, setup and the checks in a temporary worktree, with no model call', async () => {
  const { driver, repo, runner } = await setup({}, 'test -f README.md');
  withProfile(driver, (profile) => ({
    ...profile,
    preflight: [{ name: 'Login', run: 'true' }],
    commands: { ...profile.commands, setup: 'echo installing' },
  }));
  const result = await driver.checkProfile('demo', repo);
  assert.equal(result.passed, true);
  assert.deepEqual(
    result.steps.map((s) => [s.name, s.outcome]),
    [
      ['Preflight: Login', 'passed'],
      ['Worktree from main', 'passed'],
      ['Setup', 'passed'],
      ['Test', 'passed'],
      ['Full check', 'passed'],
    ],
  );
  assert.match(result.steps[2]!.output, /installing/);
  assert.equal(runner.calls.length, 0);
  assert.equal(
    sh(repo, 'worktree', 'list').trim().split('\n').length,
    1,
    'the temporary worktree is removed',
  );
});

test('the profile check stops at the first failure, names environment faults and skips the rest', async () => {
  const { driver, repo } = await setup({});
  withProfile(driver, (profile) => ({
    ...profile,
    commands: { ...profile.commands, setup: "echo 'connect ECONNREFUSED 127.0.0.1:443'; exit 1" },
  }));
  const result = await driver.checkProfile('demo', repo);
  assert.equal(result.passed, false);
  assert.deepEqual(
    result.steps.map((s) => [s.name, s.outcome]),
    [
      ['Worktree from main', 'passed'],
      ['Setup', 'failed'],
      ['Test', 'skipped'],
      ['Full check', 'skipped'],
    ],
  );
  assert.equal(result.steps[1]!.environment, 'a network service is not reachable');
  assert.equal(sh(repo, 'worktree', 'list').trim().split('\n').length, 1);
});

test('a stacked task starts from its blocker branch and opens its PR only after the blocker is pushed', async () => {
  const first = await setup({
    classifier: [ready, ready],
    coder: [writeFeature, writeOther],
    reviewer: [approveReview, approveReview],
  });
  const { driver, store, task, repo } = first;
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const blocker = (await store.read('demo', task.id)).worktree!.branch;
  const second = await store.create(
    'demo',
    repo,
    'Add other.txt on top of feature.txt',
    new Date().toISOString(),
  );
  await store.write({ ...second, stack_on: blocker });
  const stacked = await driver.run('demo', second.id, { maxAttempts: 1 });
  assert.equal(stacked.worktree!.base_branch, blocker);
  assert.ok(
    existsSync(join(stacked.worktree!.path, 'feature.txt')),
    'the blocker change is in the stacked worktree',
  );
  assert.doesNotMatch(
    (await driver.gate('demo', second.id)).diffStat,
    /feature\.txt/,
    'the diff holds only its own change',
  );
  await driver.approve('demo', second.id, { head: (await driver.gate('demo', second.id)).headSha });
  await assert.rejects(
    driver.openPr('demo', second.id),
    /open the pull request of the blocking ticket first/,
  );
});

test('a failed model call keeps its reported cost, and a usage limit says when to run again', async () => {
  const limited: Script = () => {
    throw Object.assign(new Error("model run failed: You've hit your limit"), {
      costUsd: 0.3,
      kind: 'usage-limit',
    });
  };
  const { driver, store, task } = await setup({ classifier: [ready], coder: [limited] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }));
  const stored = await store.read('demo', task.id);
  const coder = stored.attempts!.find((a) => a.step === 'coder')!;
  assert.equal(coder.cost_usd, 0.3);
  assert.match(coder.error!, /run the task again after it resets/);
});

test('after a reviewer failure, running again resumes at the reviewer without paying for the coder', async () => {
  const broken: Script = () => {
    throw new Error('model run failed: overloaded');
  };
  const { driver, task, runner } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [broken, approveReview],
  });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /overloaded/);
  const resumed = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(resumed.stage, 'awaiting-approval');
  assert.deepEqual(
    runner.calls.map((c) => c.step),
    ['classifier', 'coder', 'reviewer', 'reviewer', 'pr-writer'],
  );
});

test('opening a PR adopts one that a lost write already opened, instead of opening a second', async () => {
  const { driver, task, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  const asked: string[] = [];
  driver.deps.github.pullRequestsFrom = async ({ head }) => (
    asked.push(head),
    [
      { url: 'https://github.com/example/demo/pull/3', state: 'CLOSED', head_sha: 'an-older-commit' },
      { url: 'https://github.com/example/demo/pull/9', state: 'OPEN', head_sha: gate.headSha },
    ]
  );
  const opened = await driver.openPr('demo', task.id);
  assert.equal(opened.pr?.url, 'https://github.com/example/demo/pull/9');
  assert.equal(opened.publication, undefined, 'the intent is cleared once the PR is recorded');
  assert.deepEqual(asked, [`factory/${task.id}`]);
  assert.equal(prs.length, 0);
});

test('a PR created but not recorded is found again on retry, and a closed one for the commit needs a person', async () => {
  const { driver, task, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  // The PR is created on GitHub, then the save that records it fails (a crash at that point).
  const write = driver.deps.tasks.write.bind(driver.deps.tasks);
  let failSave = true;
  driver.deps.tasks.write = async (record) => {
    if (record.pr && failSave) {
      failSave = false;
      throw new Error('disk full');
    }
    return write(record);
  };
  const github: { url: string; state: 'OPEN' | 'CLOSED' | 'MERGED'; head_sha: string }[] = [];
  driver.deps.github.createPullRequest = async (o) => {
    prs.push(o);
    github.push({ url: 'https://github.com/example/demo/pull/1', state: 'OPEN', head_sha: gate.headSha });
    return 'https://github.com/example/demo/pull/1';
  };
  driver.deps.github.pullRequestsFrom = async () => github;
  await assert.rejects(driver.openPr('demo', task.id), /disk full/);
  const lost = await driver.deps.tasks.read('demo', task.id);
  assert.equal(lost.pr, undefined);
  assert.deepEqual([lost.publication?.step, lost.publication?.head_sha], ['create', gate.headSha]);

  const retried = await driver.openPr('demo', task.id);
  assert.equal(retried.pr?.url, 'https://github.com/example/demo/pull/1');
  assert.equal(prs.length, 1, 'the retry adopted the PR instead of opening a second');
  assert.equal(retried.publication, undefined);

  // Someone closed that PR; the task is approved again for the same commit and opened again.
  github[0]!.state = 'CLOSED';
  await driver.deps.tasks.write({ ...retried, pr: undefined, stage: 'approved' });
  await assert.rejects(driver.openPr('demo', task.id), /already exists and is closed: .*pull\/1.*Reopen it/);
  assert.equal(prs.length, 1, 'no second PR for the same commit');
});

test('the publication intent is saved before the push, so a failed push leaves a visible record', async () => {
  const { driver, task } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  driver.deps.git = {
    ...driver.deps.git,
    push: async () => {
      throw new Error('network down');
    },
  };
  await assert.rejects(driver.openPr('demo', task.id), /network down/);
  const record = await driver.deps.tasks.read('demo', task.id);
  assert.deepEqual([record.publication?.step, record.stage], ['push', 'approved']);
});

test('a commit made after the head check is not pushed: openPr sends the approved SHA only', async () => {
  const { driver, task, remote, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  const real = driver.deps.git;
  // After the head check, while openPr does its other async work, someone commits in the worktree.
  driver.deps.git = {
    ...real,
    isClean: async (dir) => {
      await writeFile(join(dir, 'late.txt'), 'late\n');
      sh(dir, 'add', 'late.txt');
      sh(dir, 'commit', '-qm', 'late commit nobody approved');
      return real.isClean(dir);
    },
  };
  const opened = await driver.openPr('demo', task.id);
  const branch = `factory/${task.id}`;
  assert.notEqual(sh(opened.worktree!.path, 'rev-parse', 'HEAD').trim(), gate.headSha, 'the branch moved');
  assert.equal(
    sh(remote, 'rev-parse', `refs/heads/${branch}`).trim(),
    gate.headSha,
    'origin has the approved SHA, not the moved branch tip',
  );
  assert.equal(opened.pr?.head_sha, gate.headSha);
  assert.equal(prs.length, 1);
});

test('a push that leaves another commit on the remote fails openPr and keeps the publication intent', async () => {
  const { driver, task, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  // The push reports success, but origin's ref is not the approved SHA (a hook, a proxy, a concurrent push).
  driver.deps.git = { ...driver.deps.git, remoteHead: async () => 'f'.repeat(40) };
  await assert.rejects(driver.openPr('demo', task.id), /after the push, not the approved/);
  const record = await driver.deps.tasks.read('demo', task.id);
  assert.deepEqual([record.publication?.step, record.publication?.head_sha], ['push', gate.headSha]);
  assert.equal(record.pr, undefined);
  assert.equal(record.stage, 'approved');
  assert.equal(prs.length, 0, 'no pull request was opened');
});

test('a runtime check (Reticle) runs after full_check: yes passes, no fails, unknown passes for a human to check', async () => {
  const withRuntime = (driver: Driver, command: string) => {
    const read = driver.deps.readProfile;
    driver.deps.readProfile = async (p) => {
      const profile = await read(p);
      return { ...profile, commands: { ...profile.commands, runtime_check: command } };
    };
  };
  for (const [script, passed, verdict, note] of [
    [
      "echo '  ✗ Console error on /: boom'; echo 'verified: no — 1 fault(s)'; exit 1",
      false,
      'no',
      /fix each ✗ line/,
    ],
    ["echo 'verified: yes — 3 page(s)'", true, 'yes', undefined],
    [
      "mkdir -p .reticle && echo j > .reticle/session.json; echo 'verified: unknown'; exit 2",
      true,
      'unknown',
      /check the running app before approving/,
    ],
  ] as const) {
    const { driver, task } = await setup({ classifier: [ready], coder: [writeFeature] });
    withRuntime(driver, script);
    await driver.classify('demo', task.id);
    await driver.prepareWorktree('demo', task.id);
    await driver.code('demo', task.id, { name: 'r', model: 'claude-sonnet-5-5', effort: 'low' });
    const result = await driver.verify('demo', task.id);
    assert.equal(result.passed, passed, `${script}\n${result.output}`);
    assert.equal(result.runtime, verdict);
    if (note) assert.match(result.output, note);
  }
});

test('a check that runs past its time limit is stopped and fails verification', async () => {
  const { driver, task } = await setup({ classifier: [ready], coder: [writeFeature] }, 'sleep 30');
  withLimits(driver, { check_timeout_minutes: 0.005 });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /still failing/);
  const failed = await driver.deps.tasks.read('demo', task.id);
  assert.equal(failed.stage, 'verification-failed');
  assert.match(failed.verification!.output_tail, /test did not finish within 1 second and was stopped/);
});
