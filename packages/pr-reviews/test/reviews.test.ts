// PR review chats with real git worktrees, a scripted GitHub and a scripted agent (no model calls).
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '@factory/adapters-fs';
import { claudeCli, type ClaudeTurnRequest } from '@factory/adapters-claude';
import { ProjectSettings, type ModelRunner } from '@factory/core';
import {
  AUTOMATED_TURN_DENY,
  ReviewService,
  SKILL_DIR,
  defaultReviewDeps,
  reviewWorktree,
  type AgentTurn,
  type ReviewDeps,
} from '../src/reviews.ts';
import { MAX_AGENTS } from '@factory/dispatcher';

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

async function fixture(
  t: TestContext,
  otherAgents = () => 0,
  claudeTurn?: ReviewDeps['claudeTurn'],
  context?: ReviewDeps['github']['context'],
  screen?: ReviewDeps['screen'],
) {
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
      ...(context ? { context } : {}),
    },
    agent: {
      ...claudeCli,
      command: process.execPath,
      args: (turn) => (turns.push(turn), [agent, turn.systemPromptFile, turn.resume ?? '-', turn.message]),
    },
    skillDir: SKILL_DIR,
    ...(claudeTurn ? { claudeTurn } : {}),
    ...(screen ? { screen } : {}),
  };
  const settings = async () =>
    ProjectSettings.parse({ task_manager: { kind: 'jira', cli: 'acli' }, review_profile: '# App profile' });
  return {
    repo,
    root,
    turns,
    reviews: new ReviewService(root, projects, settings, deps, otherAgents),
    restart: () => new ReviewService(root, projects, settings, deps, otherAgents),
  };
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

test('a review is refused when its model is turned off in the user settings', async (t) => {
  const { reviews } = await fixture(t);
  const asked: string[] = [];
  reviews.modelRefusal = async (model) => {
    asked.push(model);
    return `${model} is turned off in your user settings. Turn it on at /user, or pick another model.`;
  };
  const [result] = await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  assert.equal(result?.ok, false);
  assert.match(result?.error ?? '', /turned off in your user settings/);
  assert.deepEqual(asked, ['claude-opus-5-5']);
});

test('a running review blocks duplicates, replies and removal, and can be stopped', async (t) => {
  const { reviews } = await fixture(t);
  process.env.AGENT_SLEEP = '1';
  // Agents get an allowlisted environment; the fake reads AGENT_SLEEP, so allow it.
  process.env.FACTORY_AGENT_ENV_ALLOW = 'AGENT_SLEEP';
  t.after(() => {
    delete process.env.AGENT_SLEEP;
    delete process.env.FACTORY_AGENT_ENV_ALLOW;
  });
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

test('a Stop that arrives after the turn ended keeps the review completed', async (t) => {
  const { reviews } = await fixture(t);
  await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  const before = await settle(reviews, 7);
  await reviews.stop({ project: 'app', number: 7 });
  const after = await reviews.detail({ project: 'app', number: 7 });
  assert.deepEqual([after.state, after.stop_reason], [before.state, undefined]);
  assert.notEqual(after.state, 'stopped');
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
  assert.ok(turns.every((turn) => (turn.budgetUsd ?? 0) > 0));
  // The real CLI arguments carry the budget, the rules and an end-of-options marker before the text.
  const args = defaultReviewDeps.agent.args({ ...turns[0]!, message: '--not-a-flag' }, { systemPrompt: '' });
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
  // Agents get an allowlisted environment; the fake reads AGENT_SLEEP, so allow it.
  process.env.FACTORY_AGENT_ENV_ALLOW = 'AGENT_SLEEP';
  t.after(() => {
    delete process.env.AGENT_SLEEP;
    delete process.env.FACTORY_AGENT_ENV_ALLOW;
  });
  await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  await reviews.idle();
  assert.deepEqual(await reviews.sweep(60_000), []);
  assert.equal((await reviews.detail({ project: 'app', number: 7 })).state, 'running');
  assert.deepEqual(await reviews.sweep(0), ['app#7']);
  const stopped = await settle(reviews, 7);
  assert.deepEqual([stopped.state, stopped.stop_reason], ['stopped', 'stalled']);
});

test('a finished review turn writes one review span with its cost and PR link', async (t) => {
  const { root, reviews } = await fixture(t);
  const { TraceLog } = await import('@factory/evidence');
  reviews.traces = new TraceLog(root);
  await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  await settle(reviews, 7);
  await reviews.sweep();
  await reviews.sweep();
  const spans = await reviews.traces.read('app');
  assert.deepEqual(
    spans.map((s) => [s.type, s.name, s.cost_usd, s.pr?.number, s.outcome]),
    [['review', 'Review', 0.5, 7, 'completed']],
    'each turn is traced once',
  );
  assert.ok(spans[0]!.duration_ms! >= 0);
});

test('completed agent review is recorded once with verdict, findings and timing', async (t) => {
  const { root, reviews } = await fixture(t);
  const { DataStorage } = await import('@factory/adapters-data');
  const { PrReviewStore } = await import('../src/pr-review-records.ts');
  reviews.reviewRecords = new PrReviewStore(root, new DataStorage(root));
  await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  await settle(reviews, 7);
  await reviews.sweep();
  await reviews.sweep();
  const records = await reviews.reviewRecords.list('app');
  assert.equal(records.length, 1);
  assert.equal(records[0]!.pr_number, 7);
  assert.deepEqual(records[0]!.reviewer, { kind: 'agent', identity: 'claude' });
  assert.equal(records[0]!.verdict, 'Comment');
  assert.equal(records[0]!.findings[0]!.text, 'Edge case');
  assert.ok(records[0]!.duration_ms >= 0);
});

/**
 * An in-process turn like AGENT, through the SDK path's contract: SDK-shaped lines, the payload,
 * and a result. `hold` keeps the turn running until it is aborted.
 */
function sdkTurn(seen: ClaudeTurnRequest[], hold = () => false): NonNullable<ReviewDeps['claudeTurn']> {
  return async (request) => {
    seen.push(request);
    const session = request.turn.resume ?? 'sdk-session-1';
    const say = (e: object) => request.onLine(JSON.stringify({ session_id: session, ...e }));
    say({ type: 'system', subtype: 'init' });
    say({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: `resume ${request.turn.resume ?? '-'} got ${request.turn.message}` }],
      },
    });
    if (hold()) {
      await new Promise<void>((done) =>
        request.signal.addEventListener('abort', () => done(), { once: true }),
      );
      return { ok: false, aborted: true, reported: false, sessionId: session, error: 'aborted' };
    }
    const payload = /PAYLOAD: `([^`]+)`/.exec(request.systemPrompt)![1]!;
    await writeFile(
      payload,
      JSON.stringify({ meta: { decision: 'Comment', risk_level: 'low', summary: 'ok' }, findings: [] }),
    );
    say({ type: 'result', subtype: 'success', is_error: false, result: 'Reviewed', total_cost_usd: 0.5 });
    return { ok: true, aborted: false, reported: true, sessionId: session, costUsd: 0.5 };
  };
}

test('Claude turns run in-process on the SDK path: same files, same chat, resumed sessions', async (t) => {
  const seen: ClaudeTurnRequest[] = [];
  const { root, turns, reviews } = await fixture(t, () => 0, sdkTurn(seen));
  await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  const first = await settle(reviews, 7);
  assert.equal(first.state, 'completed');
  assert.equal(first.report, true);
  assert.equal(turns.length, 0, 'no detached CLI process was started');
  assert.deepEqual(seen[0]!.turn.deny, AUTOMATED_TURN_DENY);
  assert.match(seen[0]!.systemPrompt, /^# Senior PR Review/);
  const run = JSON.parse(await readFile(join(root, 'app', 'reviews', '7', 'run.json'), 'utf8'));
  assert.equal(run.turns[0].pid, undefined);
  assert.equal(run.turns[0].owner, reviews.instance);
  assert.equal((await readFile(join(root, 'app', 'reviews', '7', 'turn-0.exit'), 'utf8')).trim(), '0');

  await reviews.reply({ project: 'app', number: 7, text: 'Why?' });
  const second = await settle(reviews, 7);
  assert.equal(seen[1]!.turn.resume, 'sdk-session-1');
  assert.deepEqual(seen[1]!.turn.deny, [], 'a message the user typed has no automated-turn deny rules');
  const last = second.conversation.at(-1)!;
  assert.equal(last.role === 'agent' && last.blocks[0]?.text, 'resume sdk-session-1 got Why?');
});

test('an in-process turn stops on request, and one cut off by shutdown reads as interrupted', async (t) => {
  let holding = true;
  const seen: ClaudeTurnRequest[] = [];
  const { reviews, restart } = await fixture(
    t,
    () => 0,
    sdkTurn(seen, () => holding),
  );
  await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  await reviews.idle();
  assert.equal((await reviews.detail({ project: 'app', number: 7 })).state, 'running');
  assert.equal(await reviews.agentsInUse(), 1);
  await reviews.stop({ project: 'app', number: 7 });
  const stopped = await settle(reviews, 7);
  assert.deepEqual([stopped.state, stopped.can_reply], ['stopped', true]);
  assert.ok(seen[0]!.signal.aborted, 'stop aborted the SDK call');

  await reviews.reply({ project: 'app', number: 7, text: 'go on' });
  assert.equal((await reviews.detail({ project: 'app', number: 7 })).state, 'running');
  await reviews.close();
  const after = restart();
  const interrupted = await after.detail({ project: 'app', number: 7 });
  assert.deepEqual([interrupted.state, interrupted.can_reply], ['interrupted', true]);
  assert.equal(await after.agentsInUse(), 0);
  holding = false;
  await after.reply({ project: 'app', number: 7, text: 'continue' });
  const resumed = await settle(after, 7);
  assert.equal(resumed.state, 'completed');
  assert.equal(seen.at(-1)!.turn.resume, 'sdk-session-1');
});

test('shutdown lets an in-process turn finish within the drain grace', async (t) => {
  let holding = true;
  const seen: ClaudeTurnRequest[] = [];
  const { reviews, restart } = await fixture(
    t,
    () => 0,
    sdkTurn(seen, () => holding),
  );
  await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  await reviews.idle();
  assert.equal((await reviews.detail({ project: 'app', number: 7 })).state, 'running');
  // The held turn ends on abort; release it shortly after close starts, within the grace.
  setTimeout(() => {
    holding = false;
    seen[0]!.signal.dispatchEvent(new Event('abort'));
  }, 50);
  await reviews.close(5_000);
  const after = await restart().detail({ project: 'app', number: 7 });
  assert.notEqual(after.state, 'interrupted', 'a turn that ended within the grace wrote its exit file');
});

test('findings lists the saved report findings of every review, newest review first, offline', async (t) => {
  const { reviews, root } = await fixture(t);
  const save = async (number: number, at: string, payload: unknown) => {
    const dir = join(root, 'app', 'reviews', String(number));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'run.json'),
      JSON.stringify({
        number,
        branch: `b${number}`,
        url: `https://github.com/o/r/pull/${number}`,
        title: `PR ${number}`,
        worktree: '/tmp/none',
        started_at: at,
        turns: [{ at, text: 'Review it' }],
      }),
    );
    if (payload) await writeFile(join(dir, 'payload.json'), JSON.stringify(payload));
  };
  await save(7, '2026-11-01T00:00:00.000Z', {
    meta: { decision: 'request-changes' },
    findings: [
      { severity: 'must-fix', axis: 'correctness', title: 'Lost update', file: 'a.ts', line_range: '10-12' },
      { severity: 'should-fix', title: 'Name it better' },
    ],
  });
  await save(9, '2026-11-02T00:00:00.000Z', {
    meta: {},
    findings: [{ severity: 'critical', impact: 'Data loss' }],
  });
  await save(10, '2026-11-03T00:00:00.000Z', undefined);

  const rows = await reviews.findings({ project: 'app' });
  assert.deepEqual(
    rows.map((r) => [r.number, r.severity, r.finding, r.title]),
    [
      [9, 'critical', 'Data loss', 'PR 9'],
      [7, 'must-fix', 'Lost update', 'PR 7'],
      [7, 'should-fix', 'Name it better', 'PR 7'],
    ],
  );
  assert.deepEqual(
    [rows[1]!.file, rows[1]!.line_range, rows[1]!.decision],
    ['a.ts', '10-12', 'request-changes'],
  );
});

test('a review without a report says why: stopped, failed, invalid, or refused by a permission check', async () => {
  const { missingReportReason } = await import('../src/index.ts');
  const ok = { exit: '0', stopped: false };
  assert.equal(missingReportReason([], { ...ok, stopped: true }), 'The review was stopped.');
  assert.match(missingReportReason([], { ...ok, exit: '1' }), /failed before it saved a report/);
  assert.match(missingReportReason([], { ...ok, payloadError: 'bad JSON' }), /not valid: bad JSON/);
  const refused = [
    { type: 'tool-result' as const, ok: false, text: 'This command requires approval' },
    {
      type: 'tool-result' as const,
      ok: false,
      text: "Claude requested permissions to write to /d/reviews/4/payload.json, but you haven't granted it yet.",
    },
    { type: 'tool-result' as const, ok: false, text: 'grep: no such file' },
  ];
  assert.match(
    missingReportReason(refused, { ...ok, permissionMode: 'default' }),
    /refused permission to save its report; 2 of its tool calls were refused by a permission check\. The review turn ran in default permission mode/,
  );
  const { permissionModeOf } = await import('../src/index.ts');
  assert.equal(
    permissionModeOf(['x', JSON.stringify({ subtype: 'init', permissionMode: 'default' })]),
    'default',
  );
  assert.equal(permissionModeOf(['{}']), undefined);
  assert.match(
    missingReportReason(refused.slice(0, 1), ok),
    /ended without a report; 1 of its tool calls was refused/,
  );
  assert.equal(missingReportReason([], ok), 'The review ended without saving a report.');
});

test('a review turn runs sandboxed with the PR data fetched into its work dir, and a failed part does not stop it', async (t) => {
  const seen: ClaudeTurnRequest[] = [];
  const fetched: number[] = [];
  const { root, reviews } = await fixture(
    t,
    () => 0,
    sdkTurn(seen),
    async (_cwd, number) => {
      fetched.push(number);
      return {
        files: { 'pr.json': '{"title":"Change 7"}', 'pr.diff': 'diff --git a/feature.txt b/feature.txt\n' },
        failures: ['threads.json: rate limited'],
      };
    },
  );
  await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  const first = await settle(reviews, 7);
  assert.equal(first.state, 'completed');
  assert.equal(first.report, true, 'the kickoff still produced its payload');
  const dir = join(root, 'app', 'reviews', '7');
  const run = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')) as { worktree: string };
  assert.deepEqual(seen[0]!.turn.sandbox, { allowWrite: [run.worktree, join(dir, 'work')] });
  assert.equal(seen[0]!.cwd, run.worktree);
  assert.equal(await readFile(join(dir, 'work', 'pr.json'), 'utf8'), '{"title":"Change 7"}');
  assert.match(await readFile(join(dir, 'work', 'pr.diff'), 'utf8'), /^diff --git/);
  const prompt = seen[0]!.systemPrompt;
  assert.match(prompt, /### GitHub is not reachable/);
  assert.ok(prompt.includes(`\`${join(dir, 'work')}/pr.diff\``));
  assert.match(prompt, /Not fetched[^]*threads\.json: rate limited/);

  // A message the user typed is sandboxed too, and the PR is read again for it.
  await reviews.reply({ project: 'app', number: 7, text: 'Why?' });
  await settle(reviews, 7);
  assert.deepEqual(seen[1]!.turn.sandbox, { allowWrite: [run.worktree, join(dir, 'work')] });
  assert.deepEqual(fetched, [7, 7]);
});

test('a fetch that throws, or no fetch at all, leaves the turn running with the failure named', async (t) => {
  const seen: ClaudeTurnRequest[] = [];
  const { root, reviews } = await fixture(
    t,
    () => 0,
    sdkTurn(seen),
    async () => {
      throw new Error('not logged in\nhint');
    },
  );
  await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  assert.equal((await settle(reviews, 7)).state, 'completed');
  assert.match(seen[0]!.systemPrompt, /\(nothing could be fetched\)[^]*GitHub: not logged in\n/);
  assert.equal(seen[0]!.turn.sandbox?.allowWrite.length, 2);
  await assert.rejects(readFile(join(root, 'app', 'reviews', '7', 'work', 'pr.json')), /ENOENT/);

  const bare = await fixture(t, () => 0, sdkTurn(seen));
  await bare.reviews.start({ project: 'app', numbers: [7], mode: 'review' });
  assert.equal((await settle(bare.reviews, 7)).state, 'completed');
  assert.match(seen[1]!.systemPrompt, /no GitHub client is configured/);
});

test('the screen picks the model and budget of the review turn, and the run record keeps its plan', async (t) => {
  const diff =
    'diff --git a/feature.txt b/feature.txt\n--- a/feature.txt\n+++ b/feature.txt\n@@ -1 +1 @@\n+x\n-y\n';
  const context = async () => ({ files: { 'pr.diff': diff }, failures: [] });
  const low: ModelRunner = {
    run: async () => ({
      text: '',
      costUsd: 0.004,
      structured: { sure: true, files: [{ file: 'feature.txt', score: 0.05, reason: 'Trivial.' }] },
    }),
  };
  const broken: ModelRunner = {
    run: async () => {
      throw new Error('screen down');
    },
  };
  for (const [screen, model, depth] of [
    [low, 'claude-sonnet-5-5', 'sonnet'],
    [broken, 'claude-opus-5-5', 'opus'],
  ] as const) {
    const seen: ClaudeTurnRequest[] = [];
    const { root, reviews } = await fixture(t, () => 0, sdkTurn(seen), context, screen);
    await reviews.start({ project: 'app', numbers: [7], mode: 'review' });
    await settle(reviews, 7);
    assert.equal(seen[0]!.turn.model, model);
    assert.equal(seen[0]!.turn.budgetUsd, depth === 'sonnet' ? 8 : 25);
    const run = JSON.parse(await readFile(join(root, 'app', 'reviews', '7', 'run.json'), 'utf8'));
    assert.equal(run.turns[0].screen.depth, depth);
    assert.equal(run.turns[0].screen.cost_usd, depth === 'sonnet' ? 0.004 : undefined);
  }
});
