'use client';
// PR Reviews: the `elections review` picker as a screen. Open PRs ordered by what needs you first;
// select one or more to review or re-review. Each review is a chat with a report beside it.
import {
  Check,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { removeReview, startReviews, stopReview } from '@/app/actions';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import type { ReviewList, ReviewRow } from '@/lib/reviews';
import { cn } from '@/lib/utils';

type Mode = 'review' | 'rereview';
type Notice = { kind: 'error' | 'status'; text: string } | undefined;

function age(iso: string): string {
  const days = (Date.now() - Date.parse(iso)) / 86_400_000;
  if (days < 1 / 24) return '< 1h';
  if (days < 1) return `${Math.floor(days * 24)}h`;
  if (days < 7) return `${Math.floor(days)}d`;
  return `${Math.floor(days / 7)}w`;
}

function Tag({ tone, children }: { tone: 'blue' | 'amber' | 'violet' | 'muted'; children: React.ReactNode }) {
  const tones = {
    blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
    violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

function Decision({ decision }: { decision: ReviewRow['decision'] }) {
  if (decision === 'approved')
    return <span className="text-emerald-700 dark:text-emerald-400">Approved</span>;
  if (decision === 'changes') return <span className="text-destructive">Changes requested</span>;
  return <span className="text-muted-foreground">Needs review</span>;
}

const STATE_LABEL = {
  preparing: 'Preparing',
  running: 'Reviewing',
  completed: 'Reviewed',
  failed: 'Failed',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
} as const;

function ReviewState({ status }: { status: ReviewRow['review'] }) {
  if (!status.state && status.error)
    return (
      <span className="line-clamp-2 text-xs text-destructive" title={status.error}>
        Could not start: {status.error}
      </span>
    );
  if (!status.state) return <span className="text-muted-foreground/60">—</span>;
  return (
    <span className="flex flex-col">
      <span
        className={cn(
          'inline-flex items-center gap-1.5',
          (status.state === 'running' || status.state === 'preparing') && 'text-blue-700 dark:text-blue-300',
          status.state === 'completed' && 'text-emerald-700 dark:text-emerald-400',
          (status.state === 'failed' || status.state === 'interrupted') && 'text-destructive',
          status.state === 'stopped' && 'text-muted-foreground',
        )}
      >
        {(status.state === 'running' || status.state === 'preparing') && (
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
        )}
        {STATE_LABEL[status.state]}
        {status.stop_reason === 'stalled' && ' (no output)'}
      </span>
      {status.error && (
        <span className="line-clamp-2 text-xs text-destructive" title={status.error}>
          Last start failed: {status.error}
        </span>
      )}
      {status.decision && (
        <span className="text-xs text-muted-foreground">
          {status.decision}
          {status.risk ? ` · ${status.risk} risk` : ''}
        </span>
      )}
    </span>
  );
}

/** A filter chip. A link, so the filter lives in the URL; the check mark shows it is on. */
function Toggle({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? 'true' : undefined}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[0.8rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
        on && 'border-primary/40 bg-primary/10 font-medium text-foreground',
      )}
    >
      {on ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
      {children}
    </Link>
  );
}

export function PullRequestReviews({
  project,
  drafts,
  approved,
  list,
  error,
}: {
  project: string;
  drafts: boolean;
  approved: boolean;
  list: ReviewList | undefined;
  error: string | undefined;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<Notice>();
  const [failures, setFailures] = useState<Record<number, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<number>();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string>();

  const pulls = useMemo(() => list?.pulls ?? [], [list]);
  const visibleSelected = [...selected].filter((n) => pulls.some((p) => p.number === n));
  const runningKey = pulls
    .filter((p) => p.review.state === 'running' || p.review.state === 'preparing')
    .map((p) => `${p.number}:${p.review.state}`)
    .join(',');

  // While reviews are prepared or run, poll their state (cheap, local) and reload the list when one
  // changes: preparing becomes running (or fails), running finishes.
  useEffect(() => {
    if (!runningKey) return;
    const watched = runningKey.split(',').map((k) => k.split(':') as [string, string]);
    const timer = setInterval(async () => {
      const changed = await Promise.all(
        watched.map(async ([n, was]) => {
          const r = await fetch(`/api/projects/${encodeURIComponent(project)}/reviews/${n}`, {
            cache: 'no-store',
          }).catch(() => undefined);
          return r?.ok ? ((await r.json()) as { state?: string }).state !== was : false;
        }),
      );
      if (changed.some(Boolean)) router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [runningKey, project, router]);

  const query = (next: { drafts?: boolean; approved?: boolean }) => {
    const p = new URLSearchParams();
    if (next.drafts ?? drafts) p.set('drafts', '1');
    if (next.approved ?? approved) p.set('approved', '1');
    const s = p.toString();
    return `/projects/${project}/reviews${s ? `?${s}` : ''}`;
  };

  const toggle = (set: Set<number>, n: number) => {
    const next = new Set(set);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    return next;
  };

  /** One PR opens its chat once started; a batch stays on the list. */
  const launch = (numbers: number[], mode: Mode) => {
    setBusy(`${mode}:${numbers.join(',')}`);
    setNotice(undefined);
    startTransition(async () => {
      const result = await startReviews(project, numbers, mode);
      setBusy(undefined);
      const failed = Object.fromEntries((result.failed ?? []).map((f) => [f.number, f.error]));
      setFailures((prev) => {
        const next = { ...prev };
        for (const n of numbers) delete next[n];
        return { ...next, ...failed };
      });
      if (numbers.length === 1 && !result.error && !result.failed) {
        router.push(`/projects/${project}/reviews/${numbers[0]}`);
        return;
      }
      if (result.error) setNotice({ kind: 'error', text: result.error });
      else if (result.failed?.length)
        setNotice({
          kind: 'error',
          text: `${result.message ? `${result.message} ` : ''}${result.failed.length} could not start; see the rows below.`,
        });
      else if (result.message) setNotice({ kind: 'status', text: result.message });
      setSelected(new Set());
      router.refresh();
    });
  };

  const act = (label: string, call: () => Promise<{ error?: string; message?: string }>) => {
    setBusy(label);
    startTransition(async () => {
      const result = await call();
      setBusy(undefined);
      setConfirmRemove(undefined);
      setNotice(
        result.error
          ? { kind: 'error', text: result.error }
          : { kind: 'status', text: result.message ?? 'Done.' },
      );
      router.refresh();
    });
  };

  const allSelected = pulls.length > 0 && visibleSelected.length === pulls.length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PR reviews</h1>
          <p className="mt-1 text-muted-foreground">
            Each review runs the senior-pr-review agent (Claude Opus) in its own worktree and uses model
            credits.
          </p>
        </div>
        {list && <p className="text-sm text-muted-foreground">Signed in to GitHub as @{list.me}</p>}
      </div>

      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur">
        <Toggle href={query({ drafts: !drafts })} on={drafts}>
          Drafts
        </Toggle>
        <Toggle href={query({ approved: !approved })} on={approved}>
          Approved
        </Toggle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.refresh()}
          disabled={pending}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className={cn('size-3.5', pending && 'motion-safe:animate-spin')} />
        </Button>
        <div className="ml-auto flex min-h-8 items-center gap-2">
          {visibleSelected.length > 0 ? (
            <>
              <span className="text-sm text-muted-foreground tabular-nums">
                {visibleSelected.length} selected
              </span>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => launch(visibleSelected, 'rereview')}
              >
                {busy?.startsWith('rereview:') ? 'Preparing…' : 'Re-review'}
              </Button>
              <Button size="sm" disabled={pending} onClick={() => launch(visibleSelected, 'review')}>
                {busy?.startsWith('review:') ? (
                  <>
                    <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> Preparing worktrees…
                  </>
                ) : (
                  `Review ${visibleSelected.length}`
                )}
              </Button>
            </>
          ) : (
            list && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {pulls.length} open pull request{pulls.length === 1 ? '' : 's'}
              </span>
            )
          )}
        </div>
      </div>

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={cn('text-sm', notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground')}
        >
          {notice.text}
        </p>
      )}

      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Pull requests unavailable: {error}
        </p>
      ) : pulls.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center text-muted-foreground">
          <GitPullRequest className="mx-auto mb-2 size-5" />
          No open pull requests{!drafts || !approved ? ' match these filters' : ''}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          {/* Fixed layout: the pull-request column gets every pixel the narrow columns leave. */}
          <table className="w-full min-w-[820px] table-fixed text-sm">
            <colgroup>
              <col className="w-10" />
              <col />
              <col className="w-36" />
              <col className="w-40" />
              <col className="w-48" />
            </colgroup>
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="size-4 accent-primary"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(pulls.map((p) => p.number)))
                    }
                  />
                </th>
                <th className="px-2 py-2 font-medium">Pull request</th>
                <th className="px-2 py-2 font-medium">GitHub status</th>
                <th className="px-2 py-2 font-medium">Agent review</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pulls.map((pr) => {
                const expanded = open.has(pr.number);
                const status = pr.review;
                const failure = failures[pr.number];
                const hasChat = status.turns > 0;
                // The backend refuses a new review and a removal while it prepares or runs one.
                const preparing = status.state === 'preparing';
                const removable = status.state !== 'running' && !preparing && (hasChat || status.worktree);
                const chatHref = `/projects/${project}/reviews/${pr.number}`;
                return [
                  <tr
                    key={pr.number}
                    className={cn(
                      'border-b transition-colors last:border-b-0 hover:bg-muted/30',
                      expanded && 'border-b-0',
                      selected.has(pr.number) && 'bg-primary/5 hover:bg-primary/5',
                    )}
                  >
                    <td className="px-3 py-2.5 align-top">
                      <input
                        type="checkbox"
                        aria-label={`Select #${pr.number}`}
                        className="mt-0.5 size-4 accent-primary"
                        checked={selected.has(pr.number)}
                        onChange={() => setSelected((s) => toggle(s, pr.number))}
                      />
                    </td>
                    <td className="px-2 py-2.5 align-top">
                      {/* The whole title block toggles the description, not just the chevron. */}
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} the description of #${pr.number}: ${pr.title}`}
                        onClick={() => setOpen((s) => toggle(s, pr.number))}
                        className="group flex w-full min-w-0 items-start gap-1.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <ChevronRight
                          className={cn(
                            'mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground motion-safe:transition-transform',
                            expanded && 'rotate-90',
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 font-medium text-pretty" title={pr.title}>
                            <span className="text-muted-foreground tabular-nums">#{pr.number}</span>{' '}
                            {pr.title}
                          </span>
                          <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
                            <span className="shrink-0">@{pr.author}</span>
                            <span aria-hidden>·</span>
                            <span className="shrink-0 tabular-nums">{age(pr.createdAt)}</span>
                            <span aria-hidden>·</span>
                            <span className="truncate font-mono" title={pr.branch}>
                              {pr.branch}
                            </span>
                          </span>
                        </span>
                      </button>
                      <div className="mt-1.5 flex flex-wrap gap-1 empty:hidden pl-5.5">
                        {pr.requested && <Tag tone="blue">Review requested</Tag>}
                        {pr.assigned && <Tag tone="blue">Assigned</Tag>}
                        {pr.mine && <Tag tone="muted">Yours</Tag>}
                        {pr.isDraft && <Tag tone="muted">Draft</Tag>}
                        {pr.changed && <Tag tone="amber">Updated since your comment</Tag>}
                        {pr.reapprove && <Tag tone="amber">Updated since you approved</Tag>}
                        {pr.engaged && !pr.changed && <Tag tone="violet">You commented</Tag>}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 align-top whitespace-nowrap">
                      <Decision decision={pr.decision} />
                    </td>
                    <td className="px-2 py-2.5 align-top whitespace-nowrap">
                      <ReviewState status={status} />
                      {failure && (
                        <p className="mt-1 max-w-64 text-xs whitespace-normal text-destructive" role="alert">
                          {failure}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center justify-end gap-1">
                        {hasChat && (
                          <Button
                            size="sm"
                            variant="outline"
                            nativeButton={false}
                            render={<Link href={chatHref} />}
                          >
                            <MessageSquare className="size-3.5" /> Open
                          </Button>
                        )}
                        {status.state === 'running' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => act(`stop:${pr.number}`, () => stopReview(project, pr.number))}
                          >
                            <Square className="size-3.5" /> Stop
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending || preparing}
                            title={
                              hasChat
                                ? 'Start a new review chat at the latest head (the current chat is replaced)'
                                : 'Start a review chat'
                            }
                            onClick={() => launch([pr.number], 'review')}
                          >
                            {busy === `review:${pr.number}` && (
                              <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
                            )}
                            {hasChat ? 'New review' : 'Review'}
                          </Button>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Open #${pr.number} on GitHub`}
                          title="Open on GitHub"
                          nativeButton={false}
                          render={<a href={pr.url} target="_blank" rel="noopener noreferrer" />}
                        >
                          <ExternalLink className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>,
                  expanded && (
                    <tr key={`${pr.number}-details`} className="border-b bg-muted/20 last:border-b-0">
                      <td />
                      <td colSpan={4} className="px-2 pt-1 pb-4">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          Description
                          {pr.changedFiles !== undefined &&
                            ` · ${pr.changedFiles} files, +${pr.additions ?? 0} −${pr.deletions ?? 0}`}
                        </p>
                        <div className="max-h-80 max-w-3xl overflow-y-auto text-sm break-words">
                          {pr.body.trim() ? (
                            <Markdown text={pr.body} />
                          ) : (
                            <span className="text-muted-foreground">No description.</span>
                          )}
                        </div>
                        {removable && (
                          <div className="mt-3 flex items-center gap-2">
                            {confirmRemove === pr.number ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={pending}
                                  onClick={() =>
                                    act(`remove:${pr.number}`, () => removeReview(project, pr.number))
                                  }
                                >
                                  Remove worktree, chat and report
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(undefined)}>
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(pr.number)}>
                                <Trash2 className="size-3.5" /> Remove review
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
