// One senior PR review round in the ticket's activity: the decision, the summary, the findings by
// severity, what happens because of it, and a link to the full report.
import { ScanSearch } from 'lucide-react';
import Link from 'next/link';
import type { ReviewOutcome } from '@factory/core';
import { LocalTime } from '@/components/local-time';
import { DecisionChip } from '@/components/review-cycle';
import { cn } from '@factory/ui/lib/utils';

const SEVERITY_ORDER = ['critical', 'must-fix', 'blocking', 'major', 'should-fix', 'minor', 'nit', 'note'];
const SEVERITY_TONE: Record<string, string> = {
  critical: 'text-destructive',
  'must-fix': 'text-destructive',
  blocking: 'text-destructive',
  major: 'text-amber-700 dark:text-amber-400',
  'should-fix': 'text-amber-700 dark:text-amber-400',
};

export function ReviewOutcomeCard({
  project,
  at,
  outcome,
}: {
  project: string;
  at: string;
  outcome: ReviewOutcome;
}) {
  const counts = Object.entries(outcome.counts).sort(
    ([a], [b]) => (SEVERITY_ORDER.indexOf(a) + 1 || 99) - (SEVERITY_ORDER.indexOf(b) + 1 || 99),
  );
  return (
    <article
      aria-label={`Review round ${outcome.round}`}
      className="rounded-xl border bg-card px-4 py-3 shadow-xs"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <ScanSearch aria-hidden className="size-4 text-muted-foreground" />
        <span className="font-medium">
          {outcome.source === 'self' ? 'Self-review' : 'PR review'} · round {outcome.round} of #{outcome.pr}
        </span>
        <DecisionChip decision={outcome.decision} />
        <LocalTime
          iso={at}
          format="date-time"
          className="ml-auto text-xs text-muted-foreground tabular-nums"
        />
      </header>
      {outcome.summary && <p className="mt-2 text-sm">{outcome.summary}</p>}
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {counts.length ? (
          counts.map(([severity, n]) => (
            <span
              key={severity}
              className={cn('tabular-nums', SEVERITY_TONE[severity] ?? 'text-muted-foreground')}
            >
              {n} {severity}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">No findings</span>
        )}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{outcome.next}</p>
      <Link
        href={`/projects/${project}/reviews/${outcome.pr}`}
        className="mt-2 inline-block text-xs underline underline-offset-2 hover:text-foreground"
      >
        Read the full report
      </Link>
    </article>
  );
}
