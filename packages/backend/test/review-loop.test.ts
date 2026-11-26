import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TaskRecord, type ReviewPayload } from '@factory/core';
import { ReviewLoop } from '../src/review-loop.ts';

const pr = { url: 'https://github.com/o/r/pull/4', branch: 'factory/t', head_sha: 'h1', at: 'x' };
const payload = (...severities: string[]) =>
  ({
    meta: { decision: 'request-changes' },
    findings: severities.map((severity, i) => ({ severity, title: `Finding ${i + 1}` })),
  }) as unknown as ReviewPayload;

function setup(overrides: Partial<TaskRecord> = {}) {
  let task = TaskRecord.parse({
    id: '6f2c1a52-9b3e-4d1f-8a7c-2e5b9d0c4f11',
    project: 'demo',
    repo: '/r',
    prompt: 'Ship it',
    stage: 'pr-opened',
    workflow: 'agent',
    agent: 'devin',
    worktree: { path: '/w', branch: 'factory/t', base_branch: 'main' },
    pr,
    ...overrides,
  });
  const docs = new Map<string, unknown>();
  const calls: string[] = [];
  const loop = new ReviewLoop({
    tasks: { list: async () => [task], read: async () => task, taskPath: () => '/data/t/task.json' },
    storage: {
      readDocument: async (p) => {
        if (!docs.has(p)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return docs.get(p);
      },
      writeDocument: async (p, d) => void docs.set(p, d),
    },
    startReview: async (_p, n) => void calls.push(`review:${n}`),
    followUp: async (_p, _id, note) => void calls.push(`fix:${note.split('\n')[0]}`),
    note: async (_p, _id, message) => void calls.push(`note:${message}`),
    body: async () => '## Summary\n\nAdds it.\n\n---\n\n<details>record</details>',
    github: {
      markReady: async (_c, n) => void calls.push(`ready:${n}`),
      editBody: async (_c, _n, body) => void calls.push(`body:${body}`),
    },
  });
  return {
    loop,
    calls,
    task: () => task,
    state: () => loop.state(task),
    set: (patch: Partial<TaskRecord>) => (task = { ...task, ...patch }),
  };
}

test('a draft PR is reviewed, its must-fix findings fixed, reviewed again, then marked ready with notes', async () => {
  const ctx = setup();
  await ctx.loop.opened(ctx.task(), true);
  assert.deepEqual(
    ctx.calls.filter((c) => c.startsWith('review:')),
    ['review:4'],
  );

  await ctx.loop.reviewEnded('demo', 4, payload('must-fix', 'should-fix'));
  assert.equal((await ctx.state())?.state, 'fixing');
  assert.ok(
    ctx.calls.some((c) => c.startsWith('fix:The senior PR review (round 1) found 1 issue')),
    ctx.calls.join('\n'),
  );

  // The fix was pushed: the run ended with the PR open on a new head.
  ctx.set({ pr: { ...pr, head_sha: 'h2' } });
  await ctx.loop.runSettled('demo', ctx.task().id);
  assert.deepEqual(
    ctx.calls.filter((c) => c.startsWith('review:')),
    ['review:4', 'review:4'],
    'round 2',
  );

  await ctx.loop.reviewEnded('demo', 4, payload('should-fix'));
  const done = await ctx.state();
  assert.deepEqual([done?.state, done?.round, done?.fixes], ['ready', 2, 1]);
  const body = ctx.calls.find((c) => c.startsWith('body:'))!;
  assert.match(
    body,
    /## Summary\n\nAdds it\.\n\n## Automated review\n\n2 senior PR reviews, 1 fix round[\s\S]*\*\*should-fix\*\* Finding 1\n\n---/,
  );
  assert.ok(ctx.calls.includes('ready:4'));
  assert.ok(ctx.calls.some((c) => c.startsWith('note:PR #4 is ready for review, with 1 review note')));
});

test('after the last fix round the PR is marked ready without another review', async () => {
  const ctx = setup();
  await ctx.loop.opened(ctx.task(), true);
  for (const head of ['h2', 'h3']) {
    await ctx.loop.reviewEnded('demo', 4, payload('critical'));
    ctx.set({ pr: { ...pr, head_sha: head } });
    await ctx.loop.runSettled('demo', ctx.task().id);
  }
  const done = await ctx.state();
  assert.deepEqual([done?.state, done?.fixes, done?.round], ['ready', 2, 2]);
  assert.equal(ctx.calls.filter((c) => c.startsWith('review:')).length, 2, 'two reviews, no third');
  assert.match(
    ctx.calls.find((c) => c.startsWith('body:'))!,
    /Fixed in the last round, not reviewed again:\n\n- \*\*critical\*\* Finding 1/,
    'the last fix is named as not reviewed again',
  );
});

test('a fix that stops, a review without a result, a ready PR and a pipeline task stop or skip the loop', async () => {
  const ctx = setup();
  const opened = ctx.task();
  await ctx.loop.opened(opened, true);
  await ctx.loop.reviewEnded('demo', 4, payload('must-fix'));
  ctx.set({ stage: 'verification-failed' });
  await ctx.loop.runSettled('demo', opened.id);
  const stopped = await ctx.state();
  assert.equal(stopped?.state, 'stopped');
  assert.match(stopped?.reason ?? '', /stopped at verification-failed/);
  assert.ok(!ctx.calls.some((c) => c.startsWith('ready:')), 'the PR stays a draft');

  const empty = setup();
  await empty.loop.opened(opened, true);
  await empty.loop.reviewEnded('demo', 4, undefined);
  assert.match((await empty.state())?.reason ?? '', /without a result/);

  const human = setup();
  await human.loop.opened(opened, false);
  const pipeline = setup();
  await pipeline.loop.opened({ ...opened, workflow: 'pipeline' }, true);
  assert.equal(
    human.calls.length + pipeline.calls.length,
    0,
    'a ready PR or a pipeline task is left to people',
  );
});
