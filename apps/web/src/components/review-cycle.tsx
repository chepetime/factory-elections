// The review cycle on a ticket. A review ticket (someone's PR) shows its rounds and, for the latest
// proposal, the options to post; the factory's own agent PRs show their self-review loop the same
// way (rounds, findings sent back, ready for review). Server component; the buttons are client.
import { ExternalLink, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { lastRound, reviewOptions, roundRunning, type Issue, type ReviewLoopState } from '@factory/core';
import { LocalTime } from '@/components/local-time';
import {
  RestartSelfReviewButton,
  ReviewDecisionButtons,
  StartReviewButton,
} from '@/components/review-cycle-actions';
import { cn } from '@/lib/utils';

const TONE: Record<string, string> = {
  approve: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  comment: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  'request changes': 'bg-destructive/10 text-destructive',
  'needs discussion': 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  'needs attention': 'bg-destructive/10 text-destructive',
};

export function DecisionChip({ decision }: { decision?: string }) {
  if (!decision) return null;
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-xs font-medium',
        TONE[decision.toLowerCase()] ?? 'bg-muted',
      )}
    >
      {decision}
    </span>
  );
}

function Frame({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="mt-6 rounded-xl border bg-card shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** A review ticket: the PR, each round, and what to do about the latest one. */
export function ReviewTicketCard({
  project,
  issueKey,
  review,
  report,
}: {
  project: string;
  issueKey: string;
  review: NonNullable<Issue['review']>;
  /** The latest report's findings by severity, when the review chat has one. */
  report?: { counts: Record<string, number> };
}) {
  const round = lastRound(review);
  const running = roundRunning(round);
  const chat = `/projects/${project}/reviews/${review.number}`;
  return (
    <Frame
      title="PR review"
      aside={
        <span className="flex items-center gap-3 text-sm">
          <a
            href={review.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            #{review.number}
            {review.author ? ` by ${review.author}` : ''} <ExternalLink aria-hidden className="size-3.5" />
          </a>
          {review.rounds.length > 0 && (
            <Link
              href={chat}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <MessageSquare aria-hidden className="size-3.5" /> Review chat
            </Link>
          )}
        </span>
      }
    >
      {!round ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Not started. An agent reviews the PR with the senior PR review skill and proposes a decision.
          </p>
          <StartReviewButton project={project} issueKey={issueKey} label="Start the review" />
        </div>
      ) : (
        <>
          <ol className="flex flex-col gap-2" aria-label="Review rounds">
            {review.rounds.map((r, i) => (
              <li key={r.at} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">Round {i + 1}</span>
                <span className="text-xs text-muted-foreground">
                  {r.mode === 'rereview' ? 'Re-review' : 'Review'}
                  {r.head_sha ? ` of ${r.head_sha.slice(0, 7)}` : ''} ·{' '}
                  <LocalTime iso={r.at} format="date-time" />
                </span>
                <DecisionChip decision={r.decision} />
                {r.posted && (
                  <span className="text-xs text-muted-foreground">
                    {r.posted.option === 'nothing'
                      ? 'You posted nothing'
                      : r.posted.done_at
                        ? `Posted: ${r.posted.label}`
                        : `Posting: ${r.posted.label}…`}
                  </span>
                )}
                {!r.ended_at && <span className="text-xs text-muted-foreground">Reviewing…</span>}
              </li>
            ))}
          </ol>

          {round.reason && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p role="alert" className="text-sm text-destructive">
                {round.reason}
              </p>
              <StartReviewButton project={project} issueKey={issueKey} label="Review again" />
            </div>
          )}

          {round.decision && !round.posted && (
            <div className="mt-3 rounded-lg border bg-muted/30 px-3 py-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                Proposal <DecisionChip decision={round.decision} />
                {report &&
                  Object.entries(report.counts).map(([severity, n]) => (
                    <span key={severity} className="text-xs font-normal text-muted-foreground">
                      {n} {severity}
                    </span>
                  ))}
              </p>
              {round.summary && <p className="mt-1 text-sm">{round.summary}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                The agent posts what you pick, under your GitHub account.{' '}
                <Link href={chat} className="underline underline-offset-2">
                  Read the full report
                </Link>
              </p>
              <ReviewDecisionButtons
                project={project}
                issueKey={issueKey}
                options={reviewOptions(round.decision).map(({ id, label, tone }) => ({ id, label, tone }))}
              />
            </div>
          )}

          {running && round.ended_at && (
            <p className="mt-3 text-sm text-muted-foreground">Posting your choice on GitHub…</p>
          )}
        </>
      )}
    </Frame>
  );
}

const LOOP_STATE: Record<ReviewLoopState['state'], string> = {
  reviewing: 'Reviewing',
  fixing: 'The agent fixes the findings',
  ready: 'Ready for review',
  stopped: 'Stopped',
};

/** The factory's own agent PR: its self-review loop, round by round. */
export function SelfReviewCard({
  project,
  runId,
  loop,
}: {
  project: string;
  /** The run whose PR this is; with it, a stopped loop offers to review again. */
  runId?: string;
  loop: ReviewLoopState;
}) {
  return (
    <Frame
      title="Self-review"
      aside={
        <span className="flex items-center gap-3 text-sm">
          <span
            className={cn('text-xs', loop.state === 'stopped' ? 'text-destructive' : 'text-muted-foreground')}
          >
            {LOOP_STATE[loop.state]}
            {loop.cycle > 1 ? ` · cycle ${loop.cycle}` : ''}
          </span>
          <Link
            href={`/projects/${project}/reviews/${loop.pr}`}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <MessageSquare aria-hidden className="size-3.5" /> Report
          </Link>
        </span>
      }
    >
      <p className="text-xs text-muted-foreground">
        A senior PR review of the draft PR. Critical and must-fix findings go back to the agent; the PR leaves
        draft when nothing important is left, or after the last fix round.
      </p>
      {loop.history.length > 0 && (
        <ol className="mt-3 flex flex-col gap-2" aria-label="Self-review rounds">
          {loop.history.map((h) => (
            <li key={`${h.at}-${h.round}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium">Round {h.round}</span>
              <DecisionChip decision={h.decision || undefined} />
              <span className="text-xs text-muted-foreground">
                {h.sent ? `${h.sent} sent back to the agent` : 'nothing sent back'}
                {h.left ? ` · ${h.left} noted for people` : ''} · <LocalTime iso={h.at} format="date-time" />
              </span>
            </li>
          ))}
        </ol>
      )}
      {loop.state === 'stopped' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          {loop.reason && (
            <p role="alert" className="text-sm text-destructive">
              {loop.reason}
            </p>
          )}
          {runId && <RestartSelfReviewButton project={project} runId={runId} />}
        </div>
      )}
    </Frame>
  );
}
