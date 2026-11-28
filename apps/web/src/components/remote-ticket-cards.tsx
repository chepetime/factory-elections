'use client';
// Remote ticket cards: search, label filters and one card per ticket from the project's tracker.
import { ExternalLink, MessageSquare, Search, User } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { RemoteTicket } from '@factory/core';
import { Input } from '@factory/ui/components/input';
import { cn } from '@factory/ui/lib/utils';
import { LocalTime } from '@/components/local-time';

/** Labels offered as filters: the most used ones, so a long tail does not crowd the bar. */
const LABEL_FILTERS = 12;

export function TicketCards({
  tickets,
  raw,
  project,
}: {
  tickets: RemoteTicket[];
  raw: string;
  project: string;
}) {
  const [query, setQuery] = useState('');
  const [label, setLabel] = useState<string>();
  const labels = useMemo(() => {
    const counts = new Map<string, { color?: string; count: number }>();
    for (const t of tickets)
      for (const l of t.labels) {
        const seen = counts.get(l.name);
        counts.set(l.name, { ...(l.color ? { color: l.color } : {}), count: (seen?.count ?? 0) + 1 });
      }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, LABEL_FILTERS);
  }, [tickets]);
  const needle = query.trim().toLowerCase();
  const shown = tickets.filter(
    (t) =>
      (!label || t.labels.some((l) => l.name === label)) &&
      (!needle ||
        [t.key, t.title, t.state, ...t.assignees, ...t.labels.map((l) => l.name)]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(needle))),
  );
  // Only GitHub's minimal output lacks these: say how to get richer cards.
  const sparse = tickets.length > 0 && tickets.every((t) => !t.state && !t.updated_at && !t.assignees.length);

  if (!tickets.length)
    return <p className="text-sm text-muted-foreground">No open tickets. Refresh to check for new work.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="relative max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search key, title, label or person"
            aria-label="Search tickets"
            className="pl-8"
          />
        </div>
        {labels.length > 0 && (
          <div role="group" aria-label="Filter by label" className="flex flex-wrap gap-1.5">
            {labels.map(([name, { color, count }]) => (
              <button
                key={name}
                type="button"
                aria-pressed={label === name}
                onClick={() => setLabel(label === name ? undefined : name)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11',
                  label === name && 'border-foreground/40 bg-muted font-medium',
                )}
              >
                <LabelDot color={color} />
                {name}
                <span className="text-muted-foreground tabular-nums">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {shown.length === tickets.length
          ? `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`
          : `${shown.length} of ${tickets.length} tickets`}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ticket matches. Clear the search or the label.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => (
            <li key={t.key}>
              <TicketCard ticket={t} />
            </li>
          ))}
        </ul>
      )}
      {sparse && (
        <p className="text-xs text-muted-foreground">
          The list command prints only a few fields. Add{' '}
          <code className="font-mono">state,url,assignees,updatedAt,comments</code> to its{' '}
          <code className="font-mono">--json</code> list in{' '}
          <Link href={`/projects/${project}/settings`} className="underline underline-offset-4">
            ticket settings
          </Link>{' '}
          to show them on the cards.
        </p>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw output</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs">
          {raw}
        </pre>
      </details>
    </div>
  );
}

function TicketCard({ ticket: t }: { ticket: RemoteTicket }) {
  return (
    <article className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 text-sm shadow-xs transition-colors hover:border-foreground/20">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono font-medium text-foreground/80">{t.key}</span>
        {t.type && <span>{t.type}</span>}
        {t.state && (
          <span className="ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium">{t.state}</span>
        )}
      </div>
      <h2 className="line-clamp-3 font-medium leading-snug">
        {t.url ? (
          <a
            href={t.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t.title}
            <span className="sr-only"> (opens the tracker)</span>
          </a>
        ) : (
          t.title
        )}
      </h2>
      {(t.labels.length > 0 || t.priority) && (
        <ul aria-label="Labels" className="flex flex-wrap gap-1.5">
          {t.priority && (
            <li className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">{t.priority}</li>
          )}
          {t.labels.map((l) => (
            <li
              key={l.name}
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
            >
              <LabelDot color={l.color} />
              {l.name}
            </li>
          ))}
        </ul>
      )}
      <TicketFooter ticket={t} />
    </article>
  );
}

/** Who has it, its comments, when it changed and its link: whichever the tracker printed. */
function TicketFooter({ ticket: t }: { ticket: RemoteTicket }) {
  const people = t.assignees.length ? t.assignees.join(', ') : t.author;
  if (!people && !t.updated_at && t.comments === undefined && !t.url) return null;
  return (
    <div className="mt-auto flex items-center gap-3 pt-1 text-xs text-muted-foreground">
      {people && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <User aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{people}</span>
        </span>
      )}
      {t.comments !== undefined && (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <MessageSquare aria-hidden className="size-3.5" />
          {t.comments}
          <span className="sr-only"> comments</span>
        </span>
      )}
      {t.updated_at && (
        <span>
          Updated <LocalTime iso={t.updated_at} format="date-time" />
        </span>
      )}
      {t.url && (
        <a
          href={t.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${t.key} in the tracker`}
          className="ml-auto rounded-sm p-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      )}
    </div>
  );
}

/** A label's own color as a small dot; the name stays in the text color, so it always reads. */
function LabelDot({ color }: { color?: string | undefined }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full border border-foreground/15"
      style={{ backgroundColor: color ? `#${color}` : 'var(--muted-foreground)' }}
    />
  );
}
