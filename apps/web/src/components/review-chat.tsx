'use client';
// One PR review: a chat with the review agent beside its report. Polls while the agent works.
import { ArrowLeft, Bot, ExternalLink, LoaderCircle, RotateCcw, Square } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { sendReviewMessage, startReviews, stopReview } from '@/app/actions';
import { ChatComposer } from '@/components/chat-composer';
import { LocalTime } from '@/components/local-time';
import { Markdown } from '@/components/markdown';
import { ReviewReport } from '@/components/review-report';
import { ChatScroll } from '@/components/task-chat';
import { Button } from '@/components/ui/button';
import type { ReviewChatEntry, ReviewDetail } from '@/lib/reviews';
import { cn } from '@/lib/utils';

function UserBubble({ entry }: { entry: Extract<ReviewChatEntry, { role: 'user' }> }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap">
        {entry.text}
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        {entry.label ? `${entry.label} · ` : ''}
        <LocalTime iso={entry.at} />
      </p>
    </div>
  );
}

function AgentTurn({ entry, live }: { entry: Extract<ReviewChatEntry, { role: 'agent' }>; live: boolean }) {
  // Tool steps between texts collapse into one line each group, so the replies stay readable.
  const groups: ({ kind: 'text'; text: string } | { kind: 'tools'; steps: string[] })[] = [];
  for (const block of entry.blocks) {
    const last = groups.at(-1);
    if (block.kind === 'tool') {
      if (last?.kind === 'tools') last.steps.push(block.text);
      else groups.push({ kind: 'tools', steps: [block.text] });
    } else groups.push({ kind: 'text', text: block.text });
  }
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
        <Bot className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Review agent · <LocalTime iso={entry.at} />
        </p>
        {groups.map((g, i) =>
          g.kind === 'text' ? (
            <Markdown key={i} text={g.text} />
          ) : (
            <details
              key={i}
              className="group rounded-lg border bg-muted/30 px-3 py-1.5 text-xs"
              open={live && i === groups.length - 1}
            >
              <summary className="cursor-pointer text-muted-foreground select-none">
                {g.steps.length} step{g.steps.length === 1 ? '' : 's'} · {g.steps.at(-1)}
              </summary>
              <ol className="mt-1.5 flex flex-col gap-0.5 font-mono text-muted-foreground">
                {g.steps.map((s, j) => (
                  <li key={j} className="truncate" title={s}>
                    {s}
                  </li>
                ))}
              </ol>
            </details>
          ),
        )}
        {entry.result && (
          <p className={cn('text-xs', entry.result.ok ? 'text-muted-foreground' : 'text-destructive')}>
            {entry.result.ok ? 'Finished' : 'Ended with an error'}
            {entry.result.durationMs !== undefined && ` in ${Math.round(entry.result.durationMs / 60000)}m`}
            {entry.result.costUsd !== undefined && ` · $${entry.result.costUsd.toFixed(2)}`}
            {!entry.result.ok && entry.result.text && `: ${entry.result.text}`}
          </p>
        )}
      </div>
    </div>
  );
}

export function ReviewChat({
  project,
  title,
  initial,
}: {
  project: string;
  title: string;
  initial: ReviewDetail;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [tab, setTab] = useState<'chat' | 'report'>('chat');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  useEffect(() => setDetail(initial), [initial]);

  const preparing = detail.state === 'preparing';
  const running = detail.state === 'running';
  // Poll while the agent works; keep polling briefly after a send until the new turn shows up.
  const [expectTurns, setExpectTurns] = useState(0);
  // A start that failed adds no turn: its error ends the wait.
  const watching = preparing || running || (detail.turns < expectTurns && !detail.error);
  useEffect(() => {
    if (!watching) return;
    let live = true;
    const poll = async () => {
      const r = await fetch(`/api/projects/${encodeURIComponent(project)}/reviews/${detail.number}`, {
        cache: 'no-store',
      }).catch(() => undefined);
      if (live && r?.ok) setDetail((await r.json()) as ReviewDetail);
    };
    const timer = setInterval(poll, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [watching, project, detail.number]);

  const act = (call: () => Promise<{ error?: string }>, turns = detail.turns) => {
    setError(undefined);
    startTransition(async () => {
      const result = await call();
      if (result.error) setError(result.error);
      else setExpectTurns(turns);
      router.refresh();
    });
  };
  const lastAgent = detail.conversation.findLastIndex((e) => e.role === 'agent');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Link
          href={`/projects/${project}/reviews`}
          aria-label="Back to PR reviews"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold" title={title}>
            <span className="text-muted-foreground">#{detail.number}</span> {title}
          </h1>
          {(detail.branch || detail.cost_usd !== undefined) && (
            <p className="truncate text-xs text-muted-foreground">
              {detail.branch && <span className="font-mono">{detail.branch}</span>}
              {detail.branch && detail.cost_usd !== undefined && ' · '}
              {detail.cost_usd !== undefined && (
                <span title="Reported by the agent over all turns">${detail.cost_usd.toFixed(2)}</span>
              )}
            </p>
          )}
        </div>
        <div role="tablist" aria-label="Review views" className="flex rounded-lg border p-0.5">
          {(['chat', 'report'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                'h-7 rounded-md px-3 text-[0.8rem] capitalize transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                tab === t ? 'bg-foreground/5 font-medium' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t}
              {t === 'report' && detail.decision && (
                <span className="ml-1.5 text-muted-foreground">· {detail.decision}</span>
              )}
            </button>
          ))}
        </div>
        {running ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => act(() => stopReview(project, detail.number))}
          >
            <Square className="size-3.5" /> Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || !detail.can_reply}
            title="Reset the worktree to the latest head and re-review in this chat"
            onClick={() =>
              act(async () => {
                // A refused start is reported per pull request, not as a call error.
                const result = await startReviews(project, [detail.number], 'rereview');
                return { error: result.error ?? result.failed?.[0]?.error };
              }, detail.turns + 1)
            }
          >
            <RotateCcw className="size-3.5" /> Re-review
          </Button>
        )}
        {detail.url && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Open on GitHub"
            title="Open on GitHub"
            nativeButton={false}
            render={<a href={detail.url} target="_blank" rel="noopener noreferrer" />}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        )}
      </header>

      {tab === 'report' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {detail.payload ? (
            <ReviewReport payload={detail.payload} />
          ) : (
            <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-muted-foreground">
              {detail.payload_error ??
                (running
                  ? 'The report appears when the agent saves it.'
                  : 'No report was saved for this review.')}
            </p>
          )}
        </div>
      ) : (
        <>
          <ChatScroll>
            {detail.conversation.length === 0 && !preparing && !detail.error && (
              <p className="text-sm text-muted-foreground">
                No review yet. Start one from the PR reviews list.
              </p>
            )}
            {detail.conversation.map((entry, i) =>
              entry.role === 'user' ? (
                <UserBubble key={entry.id} entry={entry} />
              ) : (
                <AgentTurn key={entry.id} entry={entry} live={running && i === lastAgent} />
              ),
            )}
            {(running || preparing) && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <LoaderCircle className="size-4 motion-safe:animate-spin" />
                {preparing ? 'Fetching the PR and preparing its worktree…' : 'The agent is working…'}
              </p>
            )}
            {detail.error && !preparing && (
              <p className="text-sm text-destructive" role="alert">
                The last start failed: {detail.error}
              </p>
            )}
            {detail.stop_reason === 'stalled' && (
              <p className="text-sm text-muted-foreground" role="status">
                The backend stopped this turn: the agent wrote no output for too long. Send a message or
                re-review to continue.
              </p>
            )}
            {detail.state === 'failed' || detail.state === 'interrupted' ? (
              <p className="text-sm text-destructive" role="alert">
                {detail.state === 'failed'
                  ? `The agent exited with code ${detail.exit_code}.`
                  : 'The agent stopped unexpectedly.'}
              </p>
            ) : null}
          </ChatScroll>
          <div className="shrink-0 px-4 pb-4">
            <div className="mx-auto max-w-3xl">
              <ChatComposer
                placeholder={
                  running
                    ? 'Wait for the agent to finish, or stop it…'
                    : detail.can_reply
                      ? 'Ask a follow-up, or ask the agent to act (post the comments, re-check a finding)…'
                      : 'This chat cannot continue; start a new review.'
                }
                disabled={!detail.can_reply || running}
                sending={pending}
                error={error}
                onSend={(message) =>
                  act(() => sendReviewMessage(project, detail.number, message), detail.turns + 1)
                }
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
