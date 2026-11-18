// PR review chats with real git worktrees, a scripted GitHub and a scripted agent (no model calls).
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '@factory/adapters-fs';
import { ProjectSettings } from '@factory/core';
import {
  AUTOMATED_TURN_DENY,
  MAX_AGENTS,
  ReviewService,
  SKILL_DIR,
  defaultReviewDeps,
  reviewWorktree,
  type AgentTurn,
  type ReviewDeps,
} from '../src/reviews.ts';

const node = (number: number, branch: string) => ({
  number,
  headRefName: branch,
  title: `Change ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  body: 'Why',
  isDraft: false,
  createdAt: '2026-11-01T00:00:00Z',
  reviewDecision: null,
  headRefOid: 'x',
  author: { login: 'author' },
  assignees: { nodes: [] },
  reviewRequests: { nodes: [{ requestedReviewer: { login: 'me' } }] },
  myReviews: { nodes: [] },
  comments: { nodes: [] },
  commits: { nodes: [{ commit: { committedDate: '2026-11-02T00:00:00Z' } }] },
});

// argv: [agent.cjs, systemPromptFile, resume|-, message]. Emits stream-json like `claude -p`,
// writes the payload named in the system prompt, and sleeps when asked.
const AGENT = `
const fs = require('node:fs');
const [, , promptFile, resume, message] = process.argv;
const prompt = fs.readFileSync(promptFile, 'utf8');
const payload = prompt.match(/PAYLOAD: \`([^\`]+)\`/)[1];
const session = resume === '-' ? 'session-1' : resume;
const say = (e) => console.log(JSON.stringify({ session_id: session, ...e }));
say({ type: 'system', subtype: 'init' });
say({ type: 'assistant', message: { content: [{ type: 'text', text: 'cwd ' + process.cwd() + ' resume ' + resume + ' got ' + message }] } });
if (process.env.AGENT_SLEEP) setTimeout(() => {}, 60_000);
else {
  fs.writeFileSync(payload, JSON.stringify({ meta: { decision: 'Comment', risk_level: 'low', summary: 'ok' }, findings: [{ title: 'Edge case', severity: 'should-fix' }] }));
  say({ type: 'result', subtype: 'success', result: 'Reviewed', total_cost_usd: 0.5 });
}
`;

async function fixture(t: TestContext, otherAgents = () => 0) {
  const base = await mkdtemp(join(tmpdir(), 'factory-reviews-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const origin = join(base, 'origin.git');
  const repo = join(base, 'app');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, repo], { stdio: 'pipe' });
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'user.email', 'test@example.com');
  await writeFile(join(repo, 'README.md'), '# app\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'checkout', '-qb', 'feat/x');
  await writeFile(join(repo, 'feature.txt'), 'x\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'feature');
  git(repo, 'push', '-q', 'origin', 'feat/x');
  git(repo, 'checkout', '-q', 'main');
  const agent = join(base, 'agent.cjs');
  await writeFile(agent, AGENT);
  const root = join(base, 'data');
  const projects = new ProjectStore(root);
  await projects.add('app', repo);
  const branches: Record<number, string> = { 7: 'feat/x', 8: 'gone' };
  const turns: AgentTurn[] = [];
  const deps: ReviewDeps = {
    github: {
      login: async () => 'me',
      nodes: async () => [node(7, 'feat/x'), node(8, 'gone')],
      pull: async (_cwd: string, n: number) => ({
        branch: branches[n]!,
        url: `https://github.com/o/r/pull/${n}`,
      }),
    },
    agent: {
      command: process.execPath,
      args: (turn) => (turns.push(turn), [agent, turn.systemPromptFile, turn.resume ?? '-', turn.message]),
    },
    skillDir: SKILL_DIR,
  };
  const settings = async () =>
    ProjectSettings.parse({ task_manager: { kind: 'jira', cli: 'acli' }, review_profile: '# App profile' });
  return { repo, root, turns, reviews: new ReviewService(root, projects, settings, deps, otherAgents) };
}

async function settle(reviews: ReviewService, number: number) {
  for (let i = 0; i < 300; i++) {
    await reviews.idle();
    const detail = await reviews.detail({ project: 'app', number });
    if (detail.state !== 'running' && detail.state !== 'preparing') return detail;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error('review did not finish');
}

test('a review is a chat: kickoff in a worktree with the skill injected, then follow-ups resume it', async (t) => {
  const { repo, root, reviews } = await fixture(t);
  const tree = reviewWorktree(repo, 'feat/x');
  assert.equal(tree.path, join(repo, '..', 'reviews', 'app-feat-x'));

  assert.deepEqual(await reviews.start({ project: 'app', numbers: [7], mode: 'rereview' }), [
    { number: 7, ok: false, error: 'PR #7 has no review chat to continue' },
  ]);
  // Starting returns at once; a failure while preparing the worktree shows on the PR afterwards.
  assert.deepEqual(await reviews.start({ project: 'app', numbers: [7, 8], mode: 'review' }), [
    { number: 7, ok: true },
    { number: 8, ok: true },
  ]);
  assert.equal((await reviews.detail({ project: 'app', number: 8 })).state, 'preparing');
  const first = await settle(reviews, 7);
  const gone = await reviews.detail({ project: 'app', number: 8 });
  assert.deepEqual([gone.state, gone.error], [undefined, 'Remote branch origin/gone not found']);
  assert.equal(first.state, 'completed');
  assert.deepEqual(
    [first.report, first.decision, first.risk, first.worktree, first.can_reply],
    [true, 'Comment', 'low', true, true],
  );
  assert.equal(first.payload?.findings[0]?.title, 'Edge case');
  const cwd = await realpath(tree.path);
  assert.deepEqual(
    first.conversation.map((e) =>
      e.role === 'user' ? `user: ${e.text}` : e.blocks.map((b) => b.text).join('|'),
    ),
    [
      'user: Review PR #7 (`feat/x`). Save the payload, then reply.',
      `cwd ${cwd} resume - got Review PR #7 (\`feat/x\`). Save the payload, then reply.`,
    ],
  );
  const prompt = await readFile(join(root, 'app', 'reviews', '7', 'system-prompt.md'), 'utf8');
  assert.match(prompt, /^# Senior PR Review/);
  assert.match(prompt, /## Review context/);
  assert.match(prompt, /- CLI: acli/);
  assert.match(prompt, /# App profile/);

  await reviews.reply({ project: 'app', number: 7, text: 'Why is it should-fix?' });
  const second = await settle(reviews, 7);
  assert.equal(second.turns, 2);
  const last = second.conversation.at(-1)!;
  assert.equal(
    last.role === 'agent' && last.blocks[0]?.text,
    `cwd ${cwd} resume session-1 got Why is it should-fix?`,
  );

  // A re-review resets the worktree to the latest head and continues the same chat.
  await writeFile(join(tree.path, 'feature.txt'), 'local edit\n');
  assert.deepEqual(await reviews.start({ project: 'app', numbers: [7], mode: 'rereview' }), [
    { number: 7, ok: true },
  ]);
  const third = await settle(reviews, 7);
  assert.equal(third.turns, 3);
  assert.equal(await readFile(join(tree.path, 'feature.txt'), 'utf8'), 'x\n');

  const listed = await reviews.list({ project: 'app' });
  assert.deepEqual(
    listed.pulls.map((p) => [p.number, p.review.state, p.review.report, p.review.turns]),
    [
      [7, 'completed', true, 3],
      [8, undefined, false, 0],
    ],
  );

  await reviews.remove({ project: 'app', number: 7 });
  const removed = await reviews.detail({ project: 'app', number: 7 });
  assert.deepEqual(
    [removed.state, removed.report, removed.worktree, removed.turns],
    [undefined, false, false, 0],
  );
  assert.equal(
    execFileSync('git', ['branch', '--list', 'review/*'], { cwd: repo, encoding: 'utf8' }).trim(),
    '',
  );
});

test('a running review blocks duplicates, replies and removal, and can be stopped', async (t) => {
  const { reviews } = await fixture(t);
  process.env.AGENT_SLEEP = '1';
  t.after(() => delete process.env.AGENT_SLEEP);
  assert.deepEqual(await reviews.start({ project: 'app', numbers: [7], mode: 'review' }), [
    { number: 7, ok: true },
  ]);
  await assert.rejects(reviews.reply({ project: 'app', number: 7, text: 'hi' }), /Wait for the agent/);
  await reviews.idle();
  const running = await reviews.detail({ project: 'app', number: 7 });
  assert.deepEqual([running.state, running.can_reply], ['running', false]);
  assert.deepEqual(await reviews.start({ project: 'app', numbers: [7], mode: 'review' }), [
    { number: 7, ok: false, error: 'PR #7 is already being reviewed' },
  ]);
  await assert.rejects(reviews.reply({ project: 'app', number: 7, text: 'hi' }), /Wait for the agent/);
  await assert.rejects(reviews.remove({ project: 'app', number: 7 }), /Stop the review/);
  // Stop only after the agent reported its session, so the chat can continue.
  for (
    let i = 0;
    i < 300 && (await reviews.detail({ project: 'app', number: 7 })).conversation.length < 2;
    i++
  )
    await new Promise((done) => setTimeout(done, 20));
  await reviews.stop({ project: 'app', number: 7 });
  const stopped = await settle(reviews, 7);
  assert.deepEqual([stopped.state, stopped.report, stopped.can_reply], ['stopped', false, true]);
  await assert.rejects(reviews.detail({ project: '../x', number: 7 }));
});

test('automated turns may not post to GitHub; a message the user typed may ask the agent to', async (t) => {
  const { reviews, turns } = await fixture(t);
  await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  await settle(reviews, 7);
  await reviews.reply({ project: 'app', number: 7, text: 'Post the comments' });
  await settle(reviews, 7);
  assert.deepEqual(
    turns.map((turn) => turn.deny),
    [AUTOMATED_TURN_DENY, []],
  );
  assert.ok(turns.every((turn) => turn.budgetUsd > 0));
  // The real CLI arguments carry the budget, the rules and an end-of-options marker before the text.
  const args = defaultReviewDeps.agent.args({ ...turns[0]!, message: '--not-a-flag' });
  assert.deepEqual(args.slice(args.indexOf('--max-budget-usd'), args.indexOf('--max-budget-usd') + 2), [
    '--max-budget-usd',
    String(turns[0]!.budgetUsd),
  ]);
  assert.ok(args.includes('Bash(gh pr review:*)'));
  assert.deepEqual(args.slice(-2), ['--', '--not-a-flag']);
  const detail = await reviews.detail({ project: 'app', number: 7 });
  assert.equal(detail.cost_usd, 1);
});

test('reviews share one agent limit with task runs', async (t) => {
  let tasks = MAX_AGENTS;
  const { reviews } = await fixture(t, () => tasks);
  assert.deepEqual(await reviews.start({ project: 'app', numbers: [7], mode: 'review' }), [
    { number: 7, ok: false, error: `At most ${MAX_AGENTS} agents can run at once; wait for one to finish` },
  ]);
  tasks = MAX_AGENTS - 1;
  assert.deepEqual(await reviews.start({ project: 'app', numbers: [7, 8], mode: 'review' }), [
    { number: 7, ok: true },
    { number: 8, ok: false, error: `At most ${MAX_AGENTS} agents can run at once; wait for one to finish` },
  ]);
  await settle(reviews, 7);
});

test('a review turn with no output for the stall limit is stopped and says why', async (t) => {
  const { reviews } = await fixture(t);
  process.env.AGENT_SLEEP = '1';
  t.after(() => delete process.env.AGENT_SLEEP);
  await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  await reviews.idle();
  assert.deepEqual(await reviews.sweep(60_000), []);
  assert.equal((await reviews.detail({ project: 'app', number: 7 })).state, 'running');
  assert.deepEqual(await reviews.sweep(0), ['app#7']);
  const stopped = await settle(reviews, 7);
  assert.deepEqual([stopped.state, stopped.stop_reason], ['stopped', 'stalled']);
});
