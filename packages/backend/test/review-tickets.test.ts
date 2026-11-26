// Review tickets end to end with the real IssueService and fake review chat and GitHub: a PR
// becomes a ticket, rounds propose decisions, your choice is posted, new commits re-review, and
// a merge ends the ticket.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storageFor } from '@factory/adapters-data';
import type { ReviewPayload } from '@factory/core';
import { IssueService } from '../src/issues.ts';
import { ReviewTickets } from '../src/review-tickets.ts';

const payload = (decision: string) =>
  ({ meta: { decision, summary: `${decision}. One thing.` }, findings: [] }) as unknown as ReviewPayload;

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'factory-review-tickets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls: string[] = [];
  const github = { state: 'OPEN' as 'OPEN' | 'MERGED' | 'CLOSED', head: 'h1' };
  let tickets: ReviewTickets;
  const issues = new IssueService({
    root,
    storage: storageFor(root),
    tasks: { list: async () => [] },
    settings: async () =>
      ({ task_manager: { kind: 'none' }, tending: { enabled: false, answer_threads: false } }) as never,
    submit: async () => {
      throw new Error('a review ticket never starts a coding run');
    },
    run: async () => {},
    reject: async () => {},
    deleteRun: async () => {},
    startReview: (project, key) => tickets.start(project, key),
  });
  tickets = new ReviewTickets({
    projects: { list: async () => [{ name: 'app' }] },
    issues,
    reviews: {
      start: async ({ numbers, mode }) => (
        calls.push(`start:${numbers[0]}:${mode}`),
        [{ number: numbers[0]!, ok: true }]
      ),
      reply: async ({ number, text }) => void calls.push(`reply:${number}:${text}`),
      list: async () => ({
        pulls: [
          {
            number: 7,
            title: 'Add search',
            url: 'u7',
            author: 'ana',
            requested: true,
            mine: false,
            isDraft: false,
          },
          { number: 8, title: 'Mine', url: 'u8', author: 'me', requested: false, mine: true, isDraft: false },
        ],
      }),
    },
    github: {
      pr: async (_p, number) => ({
        state: github.state,
        head_sha: github.head,
        title: `PR ${number}`,
        url: `https://github.com/o/r/pull/${number}`,
        author: 'ana',
      }),
    },
  });
  return { issues, tickets, calls, github };
}

test('a PR becomes a review ticket in Todo; In progress starts round 1, never a coding run', async (t) => {
  const { issues, tickets, calls } = await setup(t);
  const ticket = await tickets.create('app', 12);
  assert.equal(ticket.status, 'todo');
  assert.deepEqual([ticket.review?.number, ticket.review?.rounds.length], [12, 0]);
  assert.match(ticket.title, /^Review PR #12: PR 12/);
  assert.equal((await tickets.create('app', 12)).key, ticket.key, 'one ticket per PR');
  const moved = await issues.move({ project: 'app', key: ticket.key, to: 'in_progress' });
  assert.equal(moved.issue.status, 'in_progress');
  assert.deepEqual(calls, ['start:12:review']);
  assert.deepEqual(
    [moved.issue.review?.rounds[0]?.mode, moved.issue.review?.rounds[0]?.head_sha],
    ['review', 'h1'],
  );
});

test('a round proposes a decision; your choice is posted and ends the ticket, or waits for the author', async (t) => {
  const { tickets, calls } = await setup(t);
  const { key } = await tickets.create('app', 12);
  await tickets.start('app', key);
  await tickets.turnEnded('app', 12, { kickoff: true, ok: true, payload: payload('Comment') });
  let view = await tickets.find('app', 12);
  assert.equal(view?.status, 'in_review');
  assert.deepEqual(
    [view?.review?.rounds[0]?.decision, view?.events.at(-1)?.message],
    ['Comment', 'Round 1: Comment. Pick what to post.'],
  );
  assert.deepEqual(view?.events.at(-1)?.review, {
    source: 'ticket',
    pr: 12,
    round: 1,
    decision: 'Comment',
    summary: 'Comment. One thing.',
    counts: {},
    next: 'Pick what to post on the PR: the options are on the PR review card below.',
  });
  await assert.rejects(tickets.decide('app', key, 'request-changes'), /not an option for Comment/);

  await tickets.decide('app', key, 'comment-approve');
  assert.ok(calls.includes('reply:12:1. Post the comments and approve.'), calls.join('\n'));
  assert.equal((await tickets.find('app', 12))?.status, 'in_progress');
  await assert.rejects(tickets.decide('app', key, 'comment'), /already decided/);
  await tickets.turnEnded('app', 12, { kickoff: false, ok: true });
  view = await tickets.find('app', 12);
  assert.equal(view?.status, 'done', 'an approval is the end of the review');
  assert.match(view?.events.at(-1)?.message ?? '', /Posted "Approve with comments" on PR #12/);
});

test('request changes waits for the author; new commits re-review, up to 3 rounds; a merge ends it', async (t) => {
  const { tickets, calls, github } = await setup(t);
  const { key } = await tickets.create('app', 12);
  const round = async (decision: string) => {
    await tickets.turnEnded('app', 12, { kickoff: true, ok: true, payload: payload(decision) });
    await tickets.decide('app', key, 'request-changes');
    await tickets.turnEnded('app', 12, { kickoff: false, ok: true });
  };
  await tickets.start('app', key);
  await round('Request changes');
  let view = (await tickets.find('app', 12))!;
  assert.equal(view.status, 'blocked');
  assert.match(view.events.at(-1)?.message ?? '', /Waiting for the author/);

  await tickets.watch('app', view);
  assert.equal(calls.filter((c) => c.startsWith('start:')).length, 1, 'same head: nothing to review');
  github.head = 'h2';
  await tickets.watch('app', (await tickets.find('app', 12))!);
  assert.ok(calls.includes('start:12:rereview'), calls.join('\n'));
  await round('Request changes');
  github.head = 'h3';
  await tickets.watch('app', (await tickets.find('app', 12))!);
  await round('Request changes');
  github.head = 'h4';
  await tickets.watch('app', (await tickets.find('app', 12))!);
  view = (await tickets.find('app', 12))!;
  assert.equal(view.review?.rounds.length, 3, 'no fourth round on its own');
  assert.match(view.events.at(-1)?.message ?? '', /after 3 rounds/);
  await tickets.watch('app', view);
  assert.equal(
    (await tickets.find('app', 12))!.events.filter((e) => /after 3 rounds/.test(e.message)).length,
    1,
    'said once',
  );

  github.state = 'MERGED';
  await tickets.watch('app', (await tickets.find('app', 12))!);
  view = (await tickets.find('app', 12))!;
  assert.deepEqual([view.status, view.events.at(-1)?.message], ['done', 'PR #12 was merged.']);
});

test('a round without a report blocks the ticket with the reason; the watch pass files review requests', async (t) => {
  const { tickets } = await setup(t);
  const { key } = await tickets.create('app', 12);
  await tickets.start('app', key);
  await tickets.turnEnded('app', 12, {
    kickoff: true,
    ok: true,
    reason: 'The agent was refused permission to save its report.',
  });
  const view = (await tickets.find('app', 12))!;
  assert.equal(view.status, 'blocked');
  assert.equal(view.review?.rounds[0]?.reason, 'The agent was refused permission to save its report.');
  await assert.rejects(tickets.decide('app', key, 'nothing'), /no proposal/);

  await tickets.tick();
  const filed = await tickets.find('app', 7);
  assert.equal(filed?.created_by, 'factory');
  assert.equal(filed?.status, 'todo');
  assert.equal(await tickets.find('app', 8), undefined, 'your own PRs are not filed');
});
