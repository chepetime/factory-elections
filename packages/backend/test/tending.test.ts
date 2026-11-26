import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import {
  ProjectSettings,
  type ModelRun,
  type PrState,
  type RepoProfile,
  type TaskRecord,
} from '@factory/core';
import { TendingService, type TendingGitHub } from '../src/tending.ts';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    stdio: 'pipe',
  })
    .toString()
    .trim();

async function fixture(t: TestContext, testCommand = 'true', setup?: string) {
  const base = await mkdtemp(join(tmpdir(), 'factory-tending-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  const other = join(base, 'other');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, work], { stdio: 'pipe' });
  await writeFile(join(work, 'app.txt'), 'line one\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'init');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-qb', 'factory/t1');
  await writeFile(join(work, 'app.txt'), 'line one\nfeature\n');
  git(work, 'commit', '-qam', 'feature');
  git(work, 'push', '-q', 'origin', 'factory/t1');
  execFileSync('git', ['clone', '-q', origin, other], { stdio: 'pipe' });
  const task = {
    id: 't1',
    project: 'app',
    repo: work,
    prompt: 'Add the feature',
    stage: 'pr-opened',
    worktree: { path: work, branch: 'factory/t1', base_branch: 'main' },
    pr: { url: 'https://github.com/o/r/pull/5', branch: 'factory/t1', head_sha: 'x', at: 'x' },
  } as TaskRecord;
  let pr: PrState = {
    number: 5,
    url: task.pr!.url,
    state: 'OPEN',
    head_sha: 'h1',
    base: 'main',
    mergeable: 'MERGEABLE',
    checks: [],
    threads: [],
  };
  const calls: string[] = [];
  const github: TendingGitHub = {
    me: async () => 'me',
    pr: async () => pr,
    status: async () => ({ number: pr.number, state: pr.state, draft: false }),
    rerunFailed: async (_c, id) => void calls.push(`rerun ${id}`),
    failedLog: async () => 'AssertionError: expected fixed',
    reply: async (_c, id, body) => void calls.push(`reply ${id}: ${body}`),
    resolve: async (_c, id) => void calls.push(`resolve ${id}`),
  };
  const docs = new Map<string, unknown>();
  const requests: ModelRun[] = [];
  let agent: (
    r: ModelRun,
  ) => Promise<{ text: string; structured?: unknown; costUsd: number }> = async () => ({
    text: '',
    costUsd: 0,
  });
  const tending = new TendingService({
    projects: { list: async () => [{ name: 'app' }] },
    tasks: { list: async () => [task], taskPath: () => join(base, 'data', 'task.json') },
    settings: async () => ProjectSettings.parse({ tending: { enabled: true, answer_threads: true } }),
    profile: async () =>
      ({
        commands: { test: testCommand, ...(setup ? { setup } : {}) },
        confirmed: { forbidden_paths: [], forbidden_commands: [] },
      }) as unknown as RepoProfile,
    runner: () => ({ run: async (r) => (requests.push(r), agent(r)) }),
    slot: async () => () => {},
    storage: {
      readDocument: async (p) => {
        if (!docs.has(p)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return docs.get(p);
      },
      writeDocument: async (p, d) => void docs.set(p, d),
    },
    github,
  });
  return {
    base,
    work,
    other,
    origin,
    task,
    calls,
    requests,
    tending,
    setPr: (x: Partial<PrState>) => (pr = { ...pr, ...x }),
    setAgent: (f: typeof agent) => (agent = f),
    remote: (ref: string) => git(work, 'ls-remote', origin, ref).split('\t')[0],
    settings: ProjectSettings.parse({ tending: { enabled: true, answer_threads: true } }),
  };
}

test('failing CI is rerun once, then fixed, checked and pushed as a fast-forward', async (t) => {
  const f = await fixture(t);
  f.setPr({ checks: [{ name: 'unit', state: 'fail', run_id: '42' }] });
  assert.equal((await f.tending.tend(f.task, f.settings))!.kind, 'rerun');
  assert.deepEqual(f.calls, ['rerun 42']);
  f.setAgent(async (r) => {
    assert.match(r.prompt, /expected fixed/);
    assert.equal(r.tools, 'edit');
    assert.ok(r.guard!.check('Bash', { command: 'git push origin x' }), 'the agent may not push');
    await writeFile(join(r.cwd!, 'app.txt'), 'line one\nfeature\nfixed\n');
    return { text: 'fixed', costUsd: 0.4 };
  });
  const before = f.remote('refs/heads/factory/t1');
  assert.equal((await f.tending.tend(f.task, f.settings))!.kind, 'fix-ci');
  const after = f.remote('refs/heads/factory/t1');
  assert.notEqual(after, before);
  assert.equal(
    git(f.work, 'merge-base', '--is-ancestor', before!, after!),
    '',
    'a fast-forward of the old head',
  );
  const record = (await f.tending.record(f.task))!;
  assert.deepEqual(
    record.fixes.map((x) => [x.kind, x.outcome]),
    [
      ['rerun', 'rerun'],
      ['fix-ci', 'pushed'],
    ],
  );
  assert.equal(record.fixes[1]!.cost_usd, 0.4);
  assert.equal(record.fixes_since_green, 1);
  // Green again: the allowance resets, and a merged PR ends tending.
  f.setPr({ checks: [{ name: 'unit', state: 'pass' }] });
  assert.equal((await f.tending.tend(f.task, f.settings))!.kind, 'wait');
  assert.equal((await f.tending.record(f.task))!.fixes_since_green, 0);
  f.setPr({ state: 'MERGED' });
  assert.equal((await f.tending.tend(f.task, f.settings))!.kind, 'end');
  assert.equal(await f.tending.tend(f.task, f.settings), undefined, 'an ended PR is not read again');
});

test('a fix whose test command fails is not pushed, and three failed fixes stop tending for the inbox', async (t) => {
  const f = await fixture(t, 'false');
  f.setPr({ checks: [{ name: 'unit', state: 'fail' }] });
  f.setAgent(async (r) => {
    await writeFile(join(r.cwd!, 'app.txt'), 'broken\n');
    return { text: '', costUsd: 0.1 };
  });
  const before = f.remote('refs/heads/factory/t1');
  for (let i = 0; i < 3; i++) assert.equal((await f.tending.tend(f.task, f.settings))!.kind, 'fix-ci');
  assert.equal(f.remote('refs/heads/factory/t1'), before, 'nothing was pushed');
  assert.equal(
    await readFile(join(f.work, 'app.txt'), 'utf8'),
    'line one\nfeature\n',
    'the worktree is reset',
  );
  assert.equal((await f.tending.tend(f.task, f.settings))!.kind, 'stop');
  const waiting = await f.tending.waiting('app', [f.task]);
  assert.match(waiting[0]!.reason, /3 fixes/);
  await f.tending.resume(f.task);
  assert.equal((await f.tending.waiting('app', [f.task])).length, 0);
});

test('review threads get replies; a thread the agent changed code for is resolved after the push', async (t) => {
  const f = await fixture(t);
  f.setPr({
    threads: [
      {
        id: 'A',
        resolved: false,
        outdated: false,
        comments: [{ id: 'a1', author: 'rev', body: 'Add a newline' }],
      },
      {
        id: 'B',
        resolved: false,
        outdated: false,
        comments: [{ id: 'b1', author: 'rev', body: 'Why this name?' }],
      },
    ],
  });
  f.setAgent(async (r) => {
    assert.match(r.prompt, /<thread id="A">[\s\S]*rev: Add a newline/);
    await writeFile(join(r.cwd!, 'app.txt'), 'line one\nfeature\n\n');
    return {
      text: '',
      costUsd: 0.2,
      structured: {
        replies: [
          { thread_id: 'A', reply: 'Added.', changed: true },
          { thread_id: 'B', reply: 'It matches the API.', changed: false },
          { thread_id: 'Z', reply: 'not a thread', changed: false },
        ],
      },
    };
  });
  assert.equal((await f.tending.tend(f.task, f.settings))!.kind, 'answer-threads');
  assert.deepEqual(f.calls, ['reply A: Added.', 'resolve A', 'reply B: It matches the API.']);
  assert.equal(
    (await f.tending.tend(f.task, f.settings))!.kind,
    'wait',
    'answered threads are not answered twice',
  );
});

test('a conflict with the base is merged in, resolved by the agent and pushed without a force-push', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.other, 'app.txt'), 'line one changed on main\n');
  git(f.other, 'commit', '-qam', 'main change');
  git(f.other, 'push', '-q', 'origin', 'main');
  const mainHead = f.remote('refs/heads/main')!;
  f.setPr({ mergeable: 'CONFLICTING' });
  f.setAgent(async (r) => {
    assert.match(r.prompt, /app\.txt/);
    await writeFile(join(r.cwd!, 'app.txt'), 'line one changed on main\nfeature\n');
    return { text: '', costUsd: 0.3 };
  });
  assert.equal((await f.tending.tend(f.task, f.settings))!.kind, 'merge-base');
  assert.deepEqual(
    (await f.tending.record(f.task))!.fixes.map((x) => [x.outcome, x.note ?? null]),
    [['pushed', null]],
  );
  const head = f.remote('refs/heads/factory/t1')!;
  git(f.work, 'fetch', '-q', 'origin');
  assert.equal(git(f.work, 'merge-base', '--is-ancestor', mainHead, head), '', 'the PR now contains main');
  assert.equal((await f.tending.record(f.task))!.fixes[0]!.outcome, 'pushed');
});

async function lockfileConflict(f: Awaited<ReturnType<typeof fixture>>) {
  await writeFile(join(f.other, 'app.txt'), 'line one changed on main\n');
  await writeFile(join(f.other, 'pnpm-lock.yaml'), 'lockfileVersion: main\n');
  git(f.other, 'add', '.');
  git(f.other, 'commit', '-qm', 'main change with a new lockfile');
  git(f.other, 'push', '-q', 'origin', 'main');
  f.setPr({ mergeable: 'CONFLICTING' });
  f.setAgent(async (r) => {
    await writeFile(join(r.cwd!, 'app.txt'), 'line one changed on main\nfeature\n');
    return { text: '', costUsd: 0.3 };
  });
}

test('a merged base that changes the lockfile runs setup before the test, once per lockfile', async (t) => {
  const log = join(await mkdtemp(join(tmpdir(), 'factory-tend-setup-')), 'setup.log');
  t.after(() => rm(dirname(log), { recursive: true, force: true }));
  const f = await fixture(t, 'true', `echo run >> ${log}`);
  await lockfileConflict(f);
  assert.equal((await f.tending.tend(f.task, f.settings))!.kind, 'merge-base');
  const record = (await f.tending.record(f.task))!;
  assert.equal(record.fixes.at(-1)!.outcome, 'pushed');
  assert.equal((await readFile(log, 'utf8')).trim(), 'run', 'setup ran once');
  assert.ok(record.setup_key, 'the installed lockfile is remembered');
});

test('a failed setup after a base merge is not pushed', async (t) => {
  const f = await fixture(t, 'true', 'echo install failed >&2; exit 1');
  await lockfileConflict(f);
  const before = f.remote('refs/heads/factory/t1');
  await f.tending.tend(f.task, f.settings);
  const fix = (await f.tending.record(f.task))!.fixes.at(-1)!;
  assert.equal(fix.outcome, 'failed');
  assert.match(fix.note ?? '', /setup .*failed[\s\S]*install failed/);
  assert.equal(f.remote('refs/heads/factory/t1'), before, 'nothing was pushed');
});

test('missing worktree stops tending and appears in the inbox', async (t) => {
  const f = await fixture(t);
  await rm(f.work, { recursive: true, force: true });
  assert.equal((await f.tending.tend(f.task, f.settings))?.kind, 'stop');
  assert.match((await f.tending.waiting('app', [f.task]))[0]!.reason, /Worktree is missing/);
  assert.equal((await f.tending.tend(f.task, f.settings))?.kind, 'wait');
});

test('with tending off, a conflicting PR gets one conflict follow-up per head, and a mergeable one none', async () => {
  let pr: PrState = {
    number: 4,
    url: 'https://github.com/o/r/pull/4',
    state: 'OPEN',
    head_sha: 'h1',
    base: 'main',
    mergeable: 'CONFLICTING',
    checks: [],
    threads: [],
  };
  const task = {
    id: 't1',
    project: 'app',
    repo: '/r',
    prompt: 'Ship it',
    stage: 'pr-opened',
    worktree: { path: '/r', branch: 'factory/t1', base_branch: 'main' },
    pr: { url: pr.url, branch: 'factory/t1', head_sha: 'h1', at: 'x' },
  } as TaskRecord;
  const added: string[] = [];
  const tending = new TendingService({
    projects: { list: async () => [{ name: 'app' }] },
    tasks: { list: async () => [task], taskPath: () => '/r/task.json' },
    settings: async () => ProjectSettings.parse({}),
    profile: async () => ({}) as RepoProfile,
    runner: () => ({ run: async () => ({ text: '', costUsd: 0 }) }),
    slot: async () => () => {},
    storage: { readDocument: async () => ({}), writeDocument: async () => {} },
    github: {
      me: async () => 'me',
      pr: async () => pr,
      status: async () => ({ number: pr.number, state: pr.state, draft: false }),
      rerunFailed: async () => {},
      failedLog: async () => '',
      reply: async () => {},
      resolve: async () => {},
    },
    conflictFollowUp: async (t, p) => void added.push(`${t.id}:${p.head_sha}:${p.base}`),
  });
  await tending.tick();
  assert.deepEqual(added, ['t1:h1:main'], 'the pass adds it when tending is off');
  const seen = {
    ...task,
    follow_ups: [{ at: 'x', kind: 'conflicts', note: 'n', agent: 'devin', by: 'factory', pr_head: 'h1' }],
  } as TaskRecord;
  assert.equal(await tending.watchConflict(seen), false, 'one follow-up per PR head');
  pr = { ...pr, head_sha: 'h2' };
  assert.equal(await tending.watchConflict(seen), true, 'a new head that conflicts again gets another');
  pr = { ...pr, mergeable: 'MERGEABLE' };
  assert.equal(await tending.watchConflict(task), false);
});

test("each pass reports every open-PR task's PR state, and skips conflict watch and tending once it merged", async () => {
  const task = {
    id: '11111111-2222-4333-8444-555555555555',
    project: 'app',
    repo: '/r',
    prompt: 'x',
    stage: 'pr-opened',
    workflow: 'agent',
    agent: 'devin',
    worktree: { path: '/w', branch: 'b', base_branch: 'main' },
    pr: { url: 'https://github.com/o/r/pull/5', branch: 'b', head_sha: 'h', at: '2026-11-26T00:00:00.000Z' },
  } as unknown as TaskRecord;
  const seen: string[] = [];
  let state: 'OPEN' | 'MERGED' = 'OPEN';
  const tending = new TendingService({
    projects: { list: async () => [{ name: 'app' }] },
    tasks: { list: async () => [task], taskPath: () => '/r/task.json' },
    settings: async () => ProjectSettings.parse({}),
    profile: async () => ({}) as RepoProfile,
    runner: () => ({ run: async () => ({ text: '', costUsd: 0 }) }),
    slot: async () => () => {},
    storage: { readDocument: async () => ({}), writeDocument: async () => {} },
    github: {
      me: async () => 'me',
      pr: async () => {
        seen.push('pr');
        throw new Error('not reached for a merged PR');
      },
      status: async (_cwd, number) => ({ number, state, draft: true }),
      rerunFailed: async () => {},
      failedLog: async () => '',
      reply: async () => {},
      resolve: async () => {},
    },
    conflictFollowUp: async () => void seen.push('conflict'),
    prObserved: async (_t, pr) => void seen.push(`${pr.number}:${pr.state}:${pr.draft}`),
  });
  state = 'MERGED';
  await tending.tick();
  assert.deepEqual(seen, ['5:MERGED:true'], 'a merged PR is reported and not read again for conflicts');
});
