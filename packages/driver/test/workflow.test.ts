// End-to-end workflow, intake to an opened PR: the gate, the PR draft, the ladder and verification rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as git from '@factory/adapters-git';
import { approveReview, defaultDraft, ready, setup, writeFeature, type Script } from './workflow-fixture.ts';

test('task goes from intake to an opened pull request only after approval', async () => {
  const { driver, store, task, remote, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  const reviewed = await driver.run('demo', task.id, { maxAttempts: 2 });
  assert.equal(reviewed.stage, 'awaiting-approval');
  assert.equal(reviewed.name, 'Add the feature');
  assert.equal(reviewed.verification?.passed, true);
  await assert.rejects(driver.openPr('demo', task.id), /not approved|has not approved/);
  assert.equal(prs.length, 0);

  const gate = await driver.gate('demo', task.id);
  assert.deepEqual(gate.blockers, []);
  await assert.rejects(driver.approve('demo', task.id, { head: '0000000' }), /--head/);
  await driver.approve('demo', task.id, { head: gate.headSha.slice(0, 10), note: 'ship it' });
  const opened = await driver.openPr('demo', task.id);
  assert.equal(opened.stage, 'pr-opened');
  assert.equal(prs[0]?.head, `factory/${task.id}`);
  assert.equal(prs[0]?.base, 'main');
  assert.match(prs[0]!.body, /ship it/);
  assert.equal(prs[0]?.title, 'Add the feature file');
  assert.match(prs[0]!.body, /^## Summary\n\nAdds `feature.txt`\./);
  assert.match(prs[0]!.body, /<summary>Factory record<\/summary>/);
  assert.equal(
    execFileSync('git', ['rev-parse', `refs/heads/factory/${task.id}`], {
      cwd: remote,
      encoding: 'utf8',
    }).trim(),
    gate.headSha,
  );
  const stored = await store.read('demo', task.id);
  assert.deepEqual(
    stored.attempts?.map((a) => a.step),
    ['classifier', 'coder', 'reviewer', 'pr-writer'],
  );
  await assert.rejects(driver.openPr('demo', task.id), /already has this commit/);
});

test('the PR draft is written after review and shown at the gate, a failed draft does not block', async () => {
  const brokenDraft: Script = () => ({ text: 'not json', costUsd: 0.01 });
  const { driver, store, task, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
    prWriter: [brokenDraft],
  });
  const reviewed = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(reviewed.stage, 'awaiting-approval');
  assert.equal(reviewed.pr_draft, undefined);
  assert.equal((await store.read('demo', task.id)).attempts?.at(-1)?.outcome, 'failed');

  const drafted = await driver.draftPr('demo', task.id);
  const gate = await driver.gate('demo', task.id);
  assert.equal(drafted.pr_draft?.head_sha, gate.headSha);
  await driver.approve('demo', task.id, { head: gate.headSha });
  await driver.openPr('demo', task.id);
  assert.equal(prs[0]?.title, 'Add the feature file');
});

test('a draft written for an older commit is not used', async () => {
  const { driver, task, prs } = await setup({
    classifier: [ready],
    coder: [
      writeFeature,
      async (r) => (await writeFile(join(r.cwd!, 'feature.txt'), 'v2\n'), { text: 'ok', costUsd: 0.1 }),
    ],
    reviewer: [approveReview, approveReview],
    prWriter: [defaultDraft, () => ({ text: '', costUsd: 0.01 })],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  await driver.revise('demo', task.id, 'make it v2', { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  assert.notEqual(gate.task.pr_draft?.head_sha, gate.headSha);
  await driver.approve('demo', task.id, { head: gate.headSha });
  await driver.openPr('demo', task.id);
  assert.notEqual(prs[0]?.title, 'Add the feature file');
  // Without a draft for this commit the body still keeps the factory template's headings.
  assert.match(prs[0]!.body, /^## Summary\n\nLooks right\./);
  assert.match(prs[0]!.body, /## Evidence\n[\s\S]*## Merge Danger\n/);
});

test('a draft that leaves out a template heading is asked again, and refused after a second miss', async () => {
  const partial: Script = () => ({
    text: '',
    structured: { title: 'Add the feature file', body: '## Summary\n\nAdds it.' },
    costUsd: 0.01,
  });
  const ok = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
    prWriter: [partial, defaultDraft],
  });
  const drafted = await ok.driver.run('demo', ok.task.id, { maxAttempts: 1 });
  assert.equal(drafted.pr_draft?.title, 'Add the feature file');
  assert.equal((drafted.pr_draft as { template?: string }).template, 'factory');
  const retry = ok.runner.calls.filter((c) => c.step === 'pr-writer').at(-1)!;
  assert.match(retry.prompt, /left out these template headings: Evidence, Merge Danger/);

  const bad = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
    prWriter: [partial, partial],
  });
  const refused = await bad.driver.run('demo', bad.task.id, { maxAttempts: 1 });
  assert.equal(refused.stage, 'awaiting-approval', 'a refused draft does not block the gate');
  assert.equal(refused.pr_draft, undefined);
});

test("the repository's own PR template wins over the factory's", async () => {
  const own: Script = () => ({
    text: '',
    structured: { title: 'Add the feature file', body: '## What\n\nAdds it.\n\n## Why\n\nAsked for.' },
    costUsd: 0.01,
  });
  const ctx = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
    prWriter: [own],
  });
  const repo = ctx.repo;
  await mkdir(join(repo, '.github'), { recursive: true });
  await writeFile(
    join(repo, '.github', 'pull_request_template.md'),
    '## What\n\n<!-- the change -->\n\n## Why\n',
  );
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'template'], {
    cwd: repo,
  });
  const drafted = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 1 });
  assert.equal((drafted.pr_draft as { template?: string }).template, '.github/pull_request_template.md');
  const call = ctx.runner.calls.find((c) => c.step === 'pr-writer')!;
  assert.match(call.prompt, /<template source="\.github\/pull_request_template\.md">\n## What/);
});

test('verification failure climbs the ladder with the failure output', async () => {
  const noop: Script = async (r) => (
    await writeFile(join(r.cwd!, 'other.txt'), 'x\n'),
    { text: 'ok', costUsd: null }
  );
  const { driver, task, runner } = await setup({
    classifier: [ready],
    coder: [noop, writeFeature],
    reviewer: [approveReview],
  });
  const reviewed = await driver.run('demo', task.id, { maxAttempts: 3 });
  assert.equal(reviewed.stage, 'awaiting-approval');
  const coderCalls = runner.calls.filter((c) => c.tools === 'edit');
  assert.equal(coderCalls[0]?.model, 'claude-sonnet-5-5');
  assert.equal(coderCalls[1]?.effort, 'high');
  assert.match(coderCalls[1]!.prompt, /failed verification/);
});

test('unclear tasks stop before any code', async () => {
  const unclear: Script = (r) => {
    const id = /"id": "([^"]+)"/.exec(r.prompt)![1];
    return {
      text: '',
      structured: {
        intake_id: id,
        kind: 'code',
        loe: 'unknown',
        readiness: 'needs-clarification',
        blockers: [{ kind: 'clarification', question: 'Which file?' }],
      },
      costUsd: 0,
    };
  };
  const { driver, task, runner } = await setup({ classifier: [unclear] });
  const result = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(result.stage, 'blocked');
  assert.equal(result.worktree, undefined);
  assert.equal(runner.calls.length, 1);
});

test('ready research tasks stop before creating a worktree or coding', async () => {
  const research: Script = (r) => ({
    text: '',
    structured: {
      intake_id: /"id": "([^"]+)"/.exec(r.prompt)![1],
      kind: 'research',
      loe: 'S',
      readiness: 'ready',
      blockers: [],
    },
    costUsd: 0,
  });
  const { driver, task, runner } = await setup({ classifier: [research] });
  const result = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(result.stage, 'blocked');
  assert.equal(result.worktree, undefined);
  assert.match(result.events!.at(-1)!.message, /Research workflow is not available/);
  assert.equal(runner.calls.length, 1);
  await assert.rejects(driver.prepareWorktree('demo', task.id), /not ready to code/);
});

test('coder changes to forbidden paths fail and are not committed', async () => {
  const bad: Script = async (r) => {
    execFileSync('mkdir', ['-p', join(r.cwd!, 'secrets')]);
    await writeFile(join(r.cwd!, 'secrets', 'k'), 'x');
    return { text: 'ok', costUsd: 0 };
  };
  const { driver, task, store } = await setup({ classifier: [ready], coder: [bad] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /forbidden paths/);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'failed');
  assert.equal(await git.commitCountSince(stored.worktree!.path, 'main'), 0);
});

test('the coder guard denies pushes and paths outside the worktree', async () => {
  let denials: (string | undefined)[] = [];
  const probe: Script = async (r) => {
    denials = [
      r.guard!.check('Bash', { command: 'git push origin HEAD' }),
      r.guard!.check('Read', { file_path: '/etc/passwd' }),
      r.guard!.check('Write', { file_path: join(r.cwd!, 'secrets/x') }),
      r.guard!.check('Write', { file_path: join(r.cwd!, 'feature.txt') }),
    ];
    return writeFeature(r);
  };
  const { driver, task } = await setup({ classifier: [ready], coder: [probe], reviewer: [approveReview] });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.ok(denials[0] && denials[1] && denials[2]);
  assert.equal(denials[3], undefined);
});

test('revision reruns the coder with the human note and requires a new approval', async () => {
  const revise: Script = async (r) => {
    assert.match(r.prompt, /make it louder/);
    await writeFile(join(r.cwd!, 'feature.txt'), 'DONE\n');
    return { text: 'ok', costUsd: 0 };
  };
  const { driver, task } = await setup({
    classifier: [ready],
    coder: [writeFeature, revise],
    reviewer: [approveReview, approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const first = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: first.headSha });
  const revised = await driver.revise('demo', task.id, 'make it louder', { maxAttempts: 1 });
  assert.equal(revised.stage, 'awaiting-approval');
  assert.equal(revised.approval, undefined);
  const second = await driver.gate('demo', task.id);
  assert.notEqual(first.headSha, second.headSha);
  await assert.rejects(driver.approve('demo', task.id, { head: first.headSha.slice(0, 10) }), /--head/);
  assert.equal(await readFile(join(revised.worktree!.path, 'feature.txt'), 'utf8'), 'DONE\n');
});

test('blocking review findings need explicit acceptance', async () => {
  const blocking: Script = () => ({
    text: '',
    structured: {
      verdict: 'request-changes',
      summary: 'Bug.',
      findings: [{ severity: 'blocking', message: 'wrong' }],
    },
    costUsd: 0,
  });
  const { driver, task } = await setup({ classifier: [ready], coder: [writeFeature], reviewer: [blocking] });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await assert.rejects(driver.approve('demo', task.id, { head: gate.headSha.slice(0, 10) }), /blocking/);
  const approved = await driver.approve('demo', task.id, {
    head: gate.headSha.slice(0, 10),
    acceptBlocking: true,
  });
  assert.equal(approved.stage, 'approved');
});

test('verification that leaves uncommitted files fails', async () => {
  const { driver, task, store } = await setup(
    { classifier: [ready], coder: [writeFeature] },
    'test -f feature.txt && touch artifact.out',
  );
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'verification-failed');
  assert.match(stored.verification!.output_tail, /artifact\.out/);
  assert.equal(stored.attempts?.[0]?.step, 'classifier');
});

test('verification rejects more than 400 non-test changed lines', async () => {
  const writeLarge: Script = async (r) => {
    await writeFile(join(r.cwd!, 'feature.txt'), 'line\n'.repeat(401));
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task, store } = await setup({ classifier: [ready], coder: [writeLarge] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  assert.match((await store.read('demo', task.id)).verification!.output_tail, /401 non-test lines/);
});

test('verification refuses a change that weakens tests, unless a person allowed test changes', async () => {
  const writeSkipped: Script = async (r) => {
    await writeFile(join(r.cwd!, 'feature.txt'), 'line\n');
    await writeFile(join(r.cwd!, 'feature.test.ts'), "test.skip('feature', () => {});\n");
    return { text: 'ok', costUsd: 0.1 };
  };
  const refused = await setup({ classifier: [ready], coder: [writeSkipped] });
  await assert.rejects(
    refused.driver.run('demo', refused.task.id, { maxAttempts: 1 }),
    /verification still failing/,
  );
  assert.match(
    (await refused.store.read('demo', refused.task.id)).verification!.output_tail,
    /weakens tests: skips or focuses a test in feature\.test\.ts/,
  );

  const allowed = await setup({ classifier: [ready], coder: [writeSkipped], reviewer: [approveReview] });
  await allowed.store.write({
    ...(await allowed.store.read('demo', allowed.task.id)),
    allow_test_changes: true,
  });
  assert.equal(
    (await allowed.driver.run('demo', allowed.task.id, { maxAttempts: 1 })).stage,
    'awaiting-approval',
  );
});

test('test lines do not count toward the 400 line limit', async () => {
  const writeTests: Script = async (r) => {
    await writeFile(join(r.cwd!, 'feature.txt'), 'line\n'.repeat(400));
    await writeFile(join(r.cwd!, 'feature.test.ts'), 'test\n'.repeat(500));
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task } = await setup({
    classifier: [ready],
    coder: [writeTests],
    reviewer: [approveReview],
  });
  assert.equal((await driver.run('demo', task.id, { maxAttempts: 1 })).stage, 'awaiting-approval');
});

test('verification fails when the change commits generated files', async () => {
  const writeWithCache: Script = async (r) => {
    await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
    await writeFile(join(r.cwd!, 'tsconfig.tsbuildinfo'), '{}\n');
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task, store } = await setup({ classifier: [ready], coder: [writeWithCache] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'verification-failed');
  assert.match(stored.verification!.output_tail, /generated files: tsconfig\.tsbuildinfo/);
});

test('verification rejects profile-defined generated output', async () => {
  const writeOutput: Script = async (r) => {
    await writeFile(join(r.cwd!, 'bundle.js'), 'generated');
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task, store } = await setup(
    { classifier: [ready], coder: [writeOutput] },
    'true',
    '[bundle.js]',
  );
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  assert.match((await store.read('demo', task.id)).verification!.output_tail, /generated files: bundle\.js/);
});
