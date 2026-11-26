// Review tickets: someone's PR as board work. The ticket holds the PR and its review rounds (core
// review-tickets.ts). A round runs the senior-pr-review chat (ReviewService) on the PR head and
// ends with a proposed decision; you pick what to post, and the agent posts it under your account.
// A watch pass reads each review ticket's PR: new commits start another round (up to the limit),
// a merge or close ends the ticket. It also turns PRs that request your review into tickets.
import {
  lastRound,
  REVIEW_ROUND_LIMIT,
  reviewOptions,
  reviewWatchStep,
  roundRunning,
  type Issue,
  type ReviewPayload,
} from '@factory/core';
import type { IssueView } from '@factory/core';

export interface ReviewTicketDeps {
  projects: { list(): Promise<{ name: string }[]> };
  issues: {
    list(project: string): Promise<{ prefix: string; items: IssueView[] }>;
    get(input: { project: string; key: string }): Promise<IssueView>;
    create(
      input: { project: string; title: string; description?: string; status?: 'todo'; created_by?: string },
      extra: { review: NonNullable<Issue['review']> },
    ): Promise<IssueView>;
    edit(project: string, key: string, change: (issue: Issue, at: string) => Issue): Promise<IssueView>;
  };
  reviews: {
    start(input: {
      project: string;
      numbers: number[];
      mode: 'review' | 'rereview';
    }): Promise<{ number: number; ok: boolean; error?: string }[]>;
    reply(input: { project: string; number: number; text: string }): Promise<void>;
    /** Open PRs for the project, with whether your review is requested. */
    list(input: { project: string }): Promise<{
      pulls: {
        number: number;
        title: string;
        url: string;
        author: string;
        requested: boolean;
        mine: boolean;
        isDraft: boolean;
      }[];
    }>;
  };
  github: {
    /** State, head and title of one PR, by number, in the project's repository. */
    pr(
      project: string,
      number: number,
    ): Promise<{
      state: 'OPEN' | 'MERGED' | 'CLOSED';
      head_sha: string;
      title: string;
      url: string;
      author: string;
    }>;
  };
  log?: (line: string) => void;
}

const event = (at: string, message: string) => ({ at, kind: 'review', message });

export class ReviewTickets {
  private readonly deps: ReviewTicketDeps;
  private ticking: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  constructor(deps: ReviewTicketDeps) {
    this.deps = deps;
  }

  /** The review ticket of a PR, when there is one (archived tickets count: no duplicate). */
  async find(project: string, number: number): Promise<IssueView | undefined> {
    return (await this.deps.issues.list(project)).items.find((i) => i.review?.number === number);
  }

  /** Makes a review ticket for a PR, in Todo; the existing one when the PR has a ticket. */
  async create(project: string, number: number, by: 'you' | 'factory' = 'you'): Promise<IssueView> {
    const existing = await this.find(project, number);
    if (existing) return existing;
    const pr = await this.deps.github.pr(project, number);
    if (pr.state !== 'OPEN')
      throw new Error(`PR #${number} is ${pr.state.toLowerCase()}; there is nothing to review.`);
    return this.deps.issues.create(
      {
        project,
        title: `Review PR #${number}: ${pr.title}`.slice(0, 200),
        description: `Senior PR review of [#${number}](${pr.url}) by ${pr.author}. Move it to In progress to start; the agent proposes a decision, and you pick what to post.`,
        status: 'todo',
        created_by: by,
      },
      { review: { number, url: pr.url, title: pr.title, author: pr.author, rounds: [] } },
    );
  }

  /** Starts the next round: a review the first time, a re-review of the new head after that. */
  async start(project: string, key: string): Promise<IssueView> {
    const ticket = await this.deps.issues.get({ project, key });
    const review = ticket.review;
    if (!review) throw new Error(`${ticket.key} is not a review ticket.`);
    if (roundRunning(lastRound(review))) throw new Error('A review round is already running.');
    if (review.rounds.length >= REVIEW_ROUND_LIMIT)
      await this.deps.issues.edit(project, ticket.key, (issue, at) => ({
        ...issue,
        events: [
          ...issue.events,
          event(
            at,
            `Round ${review.rounds.length + 1}: past the usual ${REVIEW_ROUND_LIMIT} rounds, started by you.`,
          ),
        ],
      }));
    const pr = await this.deps.github.pr(project, review.number);
    const mode = review.rounds.some((r) => r.ended_at) ? 'rereview' : 'review';
    let [result] = await this.deps.reviews.start({ project, numbers: [review.number], mode });
    // A re-review continues the first chat; without one (it was removed), review from scratch.
    if (!result?.ok && mode === 'rereview' && /no review (chat|worktree)/i.test(result?.error ?? ''))
      [result] = await this.deps.reviews.start({ project, numbers: [review.number], mode: 'review' });
    if (!result?.ok) throw new Error(result?.error ?? 'The review could not start.');
    return this.deps.issues.edit(project, ticket.key, (issue, at) => {
      const r = issue.review!;
      const n = r.rounds.length + 1;
      return {
        ...issue,
        status: 'in_progress',
        status_at: at,
        review: { ...r, rounds: [...r.rounds, { at, mode, head_sha: pr.head_sha }] },
        events: [...issue.events, event(at, `Review round ${n} started on ${pr.head_sha.slice(0, 7)}.`)],
      };
    });
  }

  /** You picked what to post for the latest round's decision. "Post nothing" ends the ticket. */
  async decide(project: string, key: string, optionId: string): Promise<IssueView> {
    const ticket = await this.deps.issues.get({ project, key });
    const round = ticket.review && lastRound(ticket.review);
    if (!ticket.review || !round?.decision) throw new Error('This ticket has no proposal to decide on.');
    if (round.posted) throw new Error('You already decided this round.');
    const option = reviewOptions(round.decision).find((o) => o.id === optionId);
    if (!option) throw new Error(`"${optionId}" is not an option for ${round.decision}.`);
    if (option.id !== 'nothing')
      await this.deps.reviews.reply({ project, number: ticket.review.number, text: option.text });
    return this.deps.issues.edit(project, ticket.key, (issue, at) => {
      const r = issue.review!;
      const rounds = [...r.rounds];
      const posted = {
        option: option.id,
        label: option.label,
        at,
        ...(option.id === 'nothing' ? { done_at: at } : {}),
      };
      rounds[rounds.length - 1] = { ...rounds.at(-1)!, posted };
      return {
        ...issue,
        review: { ...r, rounds },
        ...(option.id === 'nothing'
          ? { status: 'done' as const, status_at: at }
          : { status: 'in_progress' as const, status_at: at }),
        events: [
          ...issue.events,
          event(
            at,
            option.id === 'nothing'
              ? 'You chose to post nothing.'
              : `You chose: ${option.label}. Posting it on GitHub.`,
          ),
        ],
      };
    });
  }

  /** A review turn ended (ReviewService.onTurnEnded): the round's proposal, or the posting. */
  async turnEnded(
    project: string,
    number: number,
    turn: { kickoff: boolean; ok: boolean; payload?: ReviewPayload; reason?: string },
  ): Promise<void> {
    const ticket = await this.find(project, number);
    const round = ticket?.review && lastRound(ticket.review);
    if (!ticket || !round) return;
    if (turn.kickoff && !round.ended_at) {
      const decision = turn.payload?.meta.decision?.trim();
      const summary = turn.payload?.meta.summary?.trim();
      await this.deps.issues.edit(project, ticket.key, (issue, at) => {
        const r = issue.review!;
        const rounds = [...r.rounds];
        rounds[rounds.length - 1] = {
          ...rounds.at(-1)!,
          ended_at: at,
          ...(decision ? { decision } : {}),
          ...(summary ? { summary } : {}),
          ...(decision ? {} : { reason: turn.reason ?? 'The review saved no report.' }),
        };
        return {
          ...issue,
          review: { ...r, rounds },
          status: decision ? 'in_review' : 'blocked',
          status_at: at,
          events: [
            ...issue.events,
            event(
              at,
              decision
                ? `Round ${rounds.length}: ${decision}. Pick what to post.`
                : `Round ${rounds.length} ended without a report. ${turn.reason ?? ''}`.trim(),
            ),
          ],
        };
      });
      return;
    }
    if (!turn.kickoff && round.posted && !round.posted.done_at) {
      const option = reviewOptions(round.decision).find((o) => o.id === round.posted!.option);
      await this.deps.issues.edit(project, ticket.key, (issue, at) => {
        const r = issue.review!;
        const rounds = [...r.rounds];
        rounds[rounds.length - 1] = { ...rounds.at(-1)!, posted: { ...round.posted!, done_at: at } };
        const done = turn.ok && option?.done;
        return {
          ...issue,
          review: { ...r, rounds },
          status: !turn.ok ? 'blocked' : done ? 'done' : 'blocked',
          status_at: at,
          events: [
            ...issue.events,
            event(
              at,
              !turn.ok
                ? `Posting "${round.posted!.label}" did not finish. Open the review chat to see why.`
                : done
                  ? `Posted "${round.posted!.label}" on PR #${number}.`
                  : `Posted "${round.posted!.label}" on PR #${number}. Waiting for the author; new commits start the next round.`,
            ),
          ],
        };
      });
    }
  }

  startTicking(everyMs = 5 * 60_000): void {
    this.timer ??= setInterval(() => void this.tick().catch(() => undefined), everyMs);
    this.timer.unref();
  }
  stopTicking(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  tick(): Promise<void> {
    return (this.ticking ??= this.pass().finally(() => (this.ticking = undefined)));
  }

  /** One watch pass: new tickets for review requests, then each open review ticket's PR. */
  private async pass(): Promise<void> {
    for (const { name } of await this.deps.projects.list()) {
      const fail = (what: string) => (error: unknown) =>
        this.deps.log?.(
          `review tickets ${name} ${what}: ${error instanceof Error ? error.message : String(error)}`,
        );
      const requested = await this.deps.reviews
        .list({ project: name })
        .catch((e: unknown) => (fail('list')(e), undefined));
      for (const pr of requested?.pulls ?? [])
        if (pr.requested && !pr.mine && !pr.isDraft && !(await this.find(name, pr.number)))
          await this.create(name, pr.number, 'factory').catch(fail(`#${pr.number}`));
      const { items } = await this.deps.issues.list(name);
      for (const ticket of items) {
        if (!ticket.review || ticket.archived_at || ['done', 'cancelled'].includes(ticket.status)) continue;
        await this.watch(name, ticket).catch(fail(ticket.key));
      }
    }
  }

  /** Reads one review ticket's PR and does what changed: ended, new commits, or nothing. */
  async watch(project: string, ticket: IssueView): Promise<void> {
    const review = ticket.review!;
    const pr = await this.deps.github.pr(project, review.number);
    const step = reviewWatchStep(review, pr);
    if (step.kind === 'ended') {
      const merged = step.state === 'MERGED';
      await this.deps.issues.edit(project, ticket.key, (issue, at) => ({
        ...issue,
        status: merged ? 'done' : 'cancelled',
        status_at: at,
        events: [...issue.events, event(at, `PR #${review.number} was ${merged ? 'merged' : 'closed'}.`)],
      }));
    } else if (step.kind === 'rereview') {
      await this.deps.issues.edit(project, ticket.key, (issue, at) => ({
        ...issue,
        events: [...issue.events, event(at, `New commits on PR #${review.number}: reviewing them.`)],
      }));
      await this.start(project, ticket.key);
    } else if (step.kind === 'limit') {
      await this.deps.issues.edit(project, ticket.key, (issue, at) => ({
        ...issue,
        review: { ...issue.review!, limit_noted_head: pr.head_sha },
        events: [
          ...issue.events,
          event(
            at,
            `New commits on PR #${review.number} after ${REVIEW_ROUND_LIMIT} rounds. Move the ticket to In progress to review them.`,
          ),
        ],
      }));
    }
  }
}
