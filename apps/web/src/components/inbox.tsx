'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { dismissInboxItem, type ActionState } from '@/app/actions';
import type { InboxItem } from '@/lib/inbox';
import { Button } from '@/components/ui/button';

function Dismiss({ item }: { item: InboxItem }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(dismissInboxItem, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="project" value={item.project} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={`Dismiss ${item.title}`}
      >
        {pending ? 'Dismissing…' : 'Dismiss'}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
function destination(item: InboxItem) {
  const project = encodeURIComponent(item.project);
  if (item.feature_id) return `/projects/${project}/features/${encodeURIComponent(item.feature_id)}`;
  if (item.task_id) return `/projects/${project}/tasks/${encodeURIComponent(item.task_id)}`;
  if (item.pr) return `/projects/${project}/reviews`;
  return `/projects/${project}`;
}
export function Inbox({ items, error }: { items?: InboxItem[]; error?: boolean }) {
  return (
    <section aria-labelledby="inbox-title" className="mt-8 rounded-xl border bg-card p-4 shadow-xs">
      <h2 id="inbox-title" className="text-lg font-semibold">
        Inbox
      </h2>
      <p className="text-sm text-muted-foreground">Waiting for you across all projects</p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Inbox unavailable. Refresh to try again.
        </p>
      ) : !items?.length ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing is waiting on you.</p>
      ) : (
        <ul className="mt-3 divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {item.project} · {item.kind} · {item.since}
                </p>
                <Link className="font-medium underline" href={destination(item)}>
                  {item.title}
                </Link>
                <p className="text-sm">{item.action}</p>
                {item.detail && <p className="text-sm text-muted-foreground">{item.detail}</p>}
              </div>
              <Dismiss item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
