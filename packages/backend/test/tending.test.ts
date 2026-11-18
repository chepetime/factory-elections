import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function fixture(t: TestContext, testCommand = 'true') {
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
        commands: { test: testCommand },
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
