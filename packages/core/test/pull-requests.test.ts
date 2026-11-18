import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PullRequestNode,
  ProjectSettings,
  ReviewPayload,
  reviewContext,
  reviewConversation,
  reviewKickoff,
  eventSession,
  type AgentEvent,
  summarizePullRequest,
  summarizeReviewStream,
  triagePullRequests,
} from '../src/index.ts';

const me = 'me';
function pr(number: number, overrides: Partial<Record<string, unknown>> = {}): PullRequestNode {
  return PullRequestNode.parse({
    number,
    headRefName: `branch-${number}`,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    isDraft: false,
    createdAt: '2026-11-01T00:00:00Z',
    reviewDecision: null,
    headRefOid: 'head',
    author: { login: 'someone' },
    assignees: { nodes: [] },
    reviewRequests: { nodes: [] },
    myReviews: { nodes: [] },
    comments: { nodes: [] },
    commits: { nodes: [{ commit: { committedDate: '2026-11-02T00:00:00Z' } }] },
    ...overrides,
  });
}
const review = (state: string, oid: string, at = '2026-11-03T00:00:00Z') => ({
  nodes: [{ state, submittedAt: at, commit: { oid } }],
});

test('flags who is asked and what changed since my review or comment', () => {
  assert.equal(summarizePullRequest(pr(1, { author: { login: me } }), me).mine, true);
  assert.equal(
    summarizePullRequest(pr(1, { reviewRequests: { nodes: [{ requestedReviewer: { login: me } }] } }), me)
      .requested,
    true,
  );
  // Reviewed at an older commit: engaged and changed.
  const stale = summarizePullRequest(pr(1, { myReviews: review('COMMENTED', 'old') }), me);
  assert.deepEqual([stale.engaged, stale.changed], [true, true]);
  // Reviewed the current head: engaged, not changed.
  const current = summarizePullRequest(pr(1, { myReviews: review('CHANGES_REQUESTED', 'head') }), me);
  assert.deepEqual([current.engaged, current.changed], [true, false]);
  // Approved, then new commits: re-approve, not engaged.
  const approved = summarizePullRequest(pr(1, { myReviews: review('APPROVED', 'old') }), me);
  assert.deepEqual([approved.engaged, approved.reapprove], [false, true]);
  // A comment newer than the last commit compares timestamps, not commits.
  const commented = summarizePullRequest(
    pr(1, { comments: { nodes: [{ author: { login: me }, createdAt: '2026-11-05T00:00:00Z' }] } }),
    me,
  );
  assert.deepEqual([commented.engaged, commented.changed], [true, false]);
  const newer = summarizePullRequest(
    pr(1, {
      comments: { nodes: [{ author: { login: me }, createdAt: '2026-11-01T12:00:00Z' }] },
    }),
    me,
  );
  assert.equal(newer.changed, true);
});

test('triage hides drafts and settled approvals, then orders by urgency, newest first on ties', () => {
  const nodes = [
    pr(10),
    pr(9, { author: { login: me } }),
    pr(8, { isDraft: true }),
    pr(7, { reviewDecision: 'APPROVED' }),
    pr(6, { assignees: { nodes: [{ login: me }] } }),
    pr(5, { reviewRequests: { nodes: [{ requestedReviewer: { login: me } }] } }),
    pr(4, { reviewDecision: 'APPROVED', myReviews: review('APPROVED', 'old') }),
    pr(3, { myReviews: review('COMMENTED', 'old') }),
    pr(2, { reviewDecision: 'CHANGES_REQUESTED' }),
    pr(1),
  ];
  const order = (drafts: boolean, approved: boolean) =>
    triagePullRequests(nodes, me, { drafts, approved }).map((p) => p.number);
  assert.deepEqual(order(false, false), [5, 6, 3, 4, 10, 1, 2, 9]);
  assert.deepEqual(order(true, true), [5, 6, 3, 4, 10, 8, 1, 2, 7, 9]);
});

test('the review context names the skill, payload, PR, task manager and profile', () => {
  const text = reviewContext({
    skillDir: '/f/skill',
    payload: '/d/payload.json',
    workDir: '/d/work',
    pr: { number: 12, branch: 'feat/x', url: 'https://github.com/o/r/pull/12' },
    profile: '# Elections profile',
    taskManager: {
      kind: 'jira',
      cli: 'acli',
      read_ticket: 'acli jira workitem view {key}',
      list_tickets: 'acli jira workitem search --jql "project = EL AND statusCategory != Done"',
      create_epic: ' ',
    },
  });
  assert.match(text, /SKILL_DIR: `\/f\/skill`/);
  assert.match(text, /PAYLOAD: `\/d\/payload\.json`/);
  assert.match(text, /#12 \(https:\/\/github\.com\/o\/r\/pull\/12\), branch `feat\/x`/);
  assert.match(
    text,
    /- Kind: jira\n- CLI: acli\n- Read a ticket: acli jira workitem view \{key\}\n- List open tickets: acli jira workitem search/,
  );
  assert.doesNotMatch(text, /Create an epic/);
  assert.match(text, /### Project review profile\n\n# Elections profile/);
  assert.doesNotMatch(
    reviewContext({
      skillDir: 's',
      payload: 'p',
      workDir: 'w',
      pr: { number: 1, branch: 'b', url: '' },
      taskManager: { kind: 'none' },
    }),
    /Task manager/,
  );
  assert.match(reviewKickoff('rereview', { number: 3, branch: 'b' }), /^Re-review PR #3/);
});

test('the review chat pairs each message with its turn and skips sub-agent output', () => {
  const turns = [
    {
      at: 't0',
      text: 'Review PR #1',
      label: 'Review',
      events: [
        { type: 'session', id: 's1' },
        { type: 'tool', name: 'Bash', input: { command: 'gh pr view 1' } },
        { type: 'text', text: 'sub-agent noise', sub: true },
        { type: 'text', text: '**Verdict:** Approve' },
        { type: 'result', ok: true, text: '**Verdict:** Approve', costUsd: 2 },
      ] satisfies AgentEvent[],
    },
    { at: 't1', text: 'Why?', events: [] },
  ];
  assert.equal(eventSession(turns[0]!.events), 's1');
  assert.deepEqual(reviewConversation(turns), [
    { role: 'user', id: 'u0', at: 't0', text: 'Review PR #1', label: 'Review' },
    {
      role: 'agent',
      id: 'a0',
      at: 't0',
      blocks: [
        { kind: 'tool', text: 'Bash: gh pr view 1' },
        { kind: 'text', text: '**Verdict:** Approve' },
      ],
      result: { ok: true, text: '**Verdict:** Approve', costUsd: 2, durationMs: undefined },
    },
    { role: 'user', id: 'u1', at: 't1', text: 'Why?', label: undefined },
  ]);
});

test('payloads parse leniently and settings default to no task manager', () => {
  const payload = ReviewPayload.parse({
    meta: { decision: 'Comment', extra: 1 },
    findings: [{ title: 'x', more: true }],
  });
  assert.equal(payload.meta.decision, 'Comment');
  assert.deepEqual(ReviewPayload.parse({ meta: {} }).findings, []);
  assert.deepEqual(ProjectSettings.parse({}), { task_manager: { kind: 'none' } });
  assert.throws(() => ProjectSettings.parse({ icon: 'way too long icon' }));
});

test('stream summary keeps readable steps and the final result', () => {
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    'not json',
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Reading the diff\nnow' },
          { type: 'tool_use', name: 'Bash', input: { command: 'git diff --stat', description: 'Diff stat' } },
          { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Done',
      total_cost_usd: 1.5,
      duration_ms: 9,
    }),
  ];
  assert.deepEqual(summarizeReviewStream(lines), {
    steps: ['Reading the diff now', 'Bash: Diff stat', 'Read: /a.ts'],
    result: { ok: true, text: 'Done', costUsd: 1.5, durationMs: 9 },
  });
  assert.equal(summarizeReviewStream(lines, 1).steps.length, 1);
});
