// The memory page body: facts by status with the sessions that show them, pruned tools and review cost.
// Presentational; the page and the stories pass the data and the two actions.
import Link from 'next/link';
import { CONFIRMATIONS, REVIEW_EVERY, type Fact } from '@factory/core';
import { LocalTime } from '@/components/local-time';
import { RemoveFact, RestoreToolsButton } from '@/components/memory-buttons';
import type { MemorySnapshot } from '@/lib/memory';
import { Empty, PageHeader, Stat, Stats, Unavailable, usd } from '@/components/system-page';

type ActionResult = Promise<{ error?: string }>;

function FactRow({
  project,
  fact,
  forget,
}: {
  project: string;
  fact: Fact;
  forget: (project: string, id: string) => ActionResult;
}) {
  return (
    <li className="rounded-xl border bg-card p-3 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm">{fact.text}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {fact.kind} ·{' '}
            {fact.status === 'candidate' && `${fact.sessions.length} of ${CONFIRMATIONS} confirmations · `}
            added <LocalTime iso={fact.created_at} format="date-time" />, updated{' '}
            <LocalTime iso={fact.updated_at} format="date-time" />
            {fact.dropped_reason && ` · ${fact.dropped_reason}`}
          </p>
        </div>
        {fact.status !== 'dropped' && (
          <RemoveFact project={project} id={fact.id} text={fact.text} forget={forget} />
        )}
      </div>
    </li>
  );
}

function Group({
  title,
  note,
  facts,
  ...rest
}: {
  title: string;
  note: string;
  facts: Fact[];
  project: string;
  forget: (project: string, id: string) => ActionResult;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">
        {title} <span className="font-normal text-muted-foreground">({facts.length})</span>
      </h2>
      <p className="text-xs text-muted-foreground">{note}</p>
      {facts.length === 0 ? (
        <Empty>None.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {facts.map((f) => (
            <FactRow key={f.id} fact={f} {...rest} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function MemoryView({
  project,
  snapshot,
  error,
  showRemoved,
  forget,
  restore,
}: {
  project: string;
  snapshot?: MemorySnapshot;
  error?: string;
  showRemoved: boolean;
  forget: (project: string, id: string) => ActionResult;
  restore: (project: string) => ActionResult;
}) {
  const removed = snapshot?.facts.filter((f) => f.status === 'dropped') ?? [];
  const group = (title: string, note: string, facts: Fact[]) => (
    <Group title={title} note={note} facts={facts} project={project} forget={forget} />
  );
  const pick = (status: Fact['status']) => snapshot?.facts.filter((f) => f.status === status) ?? [];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Memory">
        Repository facts that earlier sessions kept rediscovering. A fact reaches agents only after{' '}
        {CONFIRMATIONS} sessions confirm it. Removing one stops agents being told; the fact stays here so a
        review does not propose it again.
      </PageHeader>
      {!snapshot ? (
        <Unavailable what="Memory" error={error ?? 'unknown error'} />
      ) : (
        <>
          <Stats>
            <Stat label="Sessions recorded" value={snapshot.sessions} />
            <Stat label="Until next review" value={Math.max(0, REVIEW_EVERY - snapshot.pending)} />
            <Stat label="Review cost" value={usd(snapshot.review_cost_usd)} />
          </Stats>
          {group('Active', 'Told to every agent in this project.', pick('active'))}
          {group(
            'Candidates',
            `Proposed by a review; told to agents once ${CONFIRMATIONS} sessions confirm them.`,
            pick('candidate'),
          )}
          <Link
            className="text-sm underline underline-offset-2"
            href={`/projects/${project}/memory${showRemoved ? '' : '?show=removed'}`}
          >
            {showRemoved ? 'Hide' : 'Show'} removed facts ({removed.length})
          </Link>
          {showRemoved &&
            group('Removed', 'Not told to agents, and never proposed again with the same text.', removed)}
          <section aria-label="Pruned tools" className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Pruned tools</h2>
            {snapshot.pruned_tools.length === 0 ? (
              <Empty>Review turns get every built-in tool.</Empty>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Review turns have not used these in a while, so they leave them out:{' '}
                  <span className="font-mono">{snapshot.pruned_tools.join(', ')}</span>
                </p>
                <RestoreToolsButton project={project} restore={restore} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
