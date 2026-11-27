'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { dismissInboxItem, type ActionState } from '@/app/actions';
import { LocalTime } from '@/components/local-time';
import { Button } from '@factory/ui/components/button';
import type { InboxItem } from '@/lib/inbox';
import { cn } from '@factory/ui/lib/utils';

// Kinds come from packages/core/src/inbox.ts. The dot uses the run attention tones: red for a
// problem, amber for a reply someone waits on, blue for a review or decision, green to finish.
const KIND: Record<string, { label: string; dot: string }> = {
  failed: { label: 'Failed', dot: 'bg-destructive' },
  blocked: { label: 'Needs a reply', dot: 'bg-amber-500' },
  gate: { label: 'Needs approval', dot: 'bg-blue-500' },
  question: { label: 'Question', dot: 'bg-amber-500' },
  'approve-spec': { label: 'Approve spec', dot: 'bg-blue-500' },
  'approve-board': { label: 'Approve board', dot: 'bg-blue-500' },
  qa: { label: 'QA', dot: 'bg-blue-500' },
  merge: { label: 'Ready to merge', dot: 'bg-emerald-500' },
  review: { label: 'PR review', dot: 'bg-blue-500' },
  tending: { label: 'PR tending', dot: 'bg-blue-500' },
  recovery: { label: 'Recovery', dot: 'bg-destructive' },
  finding: { label: 'Finding', dot: 'bg-blue-500' },
};

function Dismiss({ item }: { item: InboxItem }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(dismissInboxItem, {});
  return (
    <form action={action} className="relative z-10 flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="project" value={item.project} />
      {/* Hidden until the row is hovered or focused on mouse screens; touch screens always show it. */}
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Dismiss ${item.title}`}
        className={cn(
          'text-muted-foreground motion-safe:transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100 pointer-fine:group-focus-within:opacity-100',
          pending && 'pointer-fine:opacity-100',
        )}
      >
        {pending ? 'Dismissing…' : 'Dismiss'}
      </Button>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function inboxDestination(item: InboxItem) {
  const project = encodeURIComponent(item.project);
  if (item.feature_id) return `/projects/${project}/features/${encodeURIComponent(item.feature_id)}`;
  if (item.task_key) return `/projects/${project}/tasks/${encodeURIComponent(item.task_key)}`;
  if (item.task_id) return `/projects/${project}/tasks/${encodeURIComponent(item.task_id)}`;
  if (item.pr) return `/projects/${project}/reviews`;
  return `/projects/${project}`;
}

export function Inbox({
  items,
  error,
  project,
}: {
  items?: InboxItem[];
  error?: boolean;
  /** The project on screen; items from it skip the project name. */
  project?: string;
}) {
  return (
    <section aria-labelledby="inbox-title" className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div className="px-5 pt-4 pb-3">
        <h2 id="inbox-title" className="flex items-baseline gap-2 text-base font-semibold">
          Inbox
          {!!items?.length && (
            <span className="text-sm font-normal text-muted-foreground tabular-nums">{items.length}</span>
          )}
        </h2>
        <p className="text-sm text-muted-foreground">Waiting for you across all projects.</p>
      </div>
      {error ? (
        <p role="alert" className="px-5 pb-4 text-sm text-destructive">
          Inbox unavailable. Refresh to try again.
        </p>
      ) : !items?.length ? (
        <p className="px-5 pb-4 text-sm text-muted-foreground">
          Nothing is waiting on you. Failed runs, approvals and reviews show up here.
        </p>
      ) : (
        <ul className="divide-y border-t">
          {items.map((item) => {
            const kind = KIND[item.kind] ?? { label: item.kind, dot: 'bg-muted-foreground/50' };
            return (
              <li
                key={item.id}
                className="group relative flex items-start gap-4 px-5 py-3.5 hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      <span className={cn('size-1.5 rounded-full', kind.dot)} aria-hidden />
                      {kind.label}
                    </span>
                    {item.project !== project && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{item.project}</span>
                      </>
                    )}
                    <span aria-hidden>·</span>
                    <LocalTime iso={item.since} format="date-time" />
                  </p>
                  {/* The link covers the whole row; Dismiss sits above it. */}
                  <Link
                    href={inboxDestination(item)}
                    className="mt-1 block text-sm font-medium outline-none after:absolute after:inset-0 group-hover:underline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                  >
                    {item.task_key && (
                      <span className="mr-1.5 font-mono text-xs font-normal text-muted-foreground">
                        {item.task_key}
                      </span>
                    )}
                    {item.title}
                  </Link>
                  <p className="mt-0.5 text-sm text-muted-foreground">{item.action}</p>
                  {item.detail && <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>}
                </div>
                <Dismiss item={item} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
