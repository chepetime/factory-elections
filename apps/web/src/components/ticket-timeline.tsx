// The ticket's vertical timeline for the task panel: the models that worked it, then every step
// from creation to now, oldest first, with each run's models under its start. Older entries fold.
import {
  Bot,
  CircleCheck,
  CircleDot,
  CircleX,
  GitPullRequest,
  MessageSquarePlus,
  Pencil,
  Play,
  Plus,
  ScanSearch,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { LocalTime } from '@/components/local-time';
import { modelName } from '@/lib/agent-models';
import type { ModelTotal, ModelUse, TimelineEntry, TimelineKind } from '@/lib/ticket-timeline';
import { cn } from '@factory/ui/lib/utils';

const ICON: Record<TimelineKind, LucideIcon> = {
  created: Plus,
  status: CircleDot,
  edit: Pencil,
  agent: Bot,
  run: Play,
  check: ShieldCheck,
  approval: CircleCheck,
  pr: GitPullRequest,
  'follow-up': MessageSquarePlus,
  review: ScanSearch,
  note: CircleDot,
};
/** Entries shown before the fold; the newest ones, since they matter most. */
const SHOWN = 10;

const usd = (n: number | null) =>
  n === null ? 'cost unknown' : n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`;
const calls = (n: number) => `${n} ${n === 1 ? 'call' : 'calls'}`;

function ModelChips({ uses }: { uses: ModelUse[] }) {
  return (
    <ul className="mt-1.5 flex flex-col gap-1" aria-label="Models">
      {uses.map((u) => (
        <li
          key={`${u.model}/${u.step}`}
          className="flex flex-wrap items-baseline gap-x-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs"
        >
          <span className="font-medium">{modelName(u.model)}</span>
          <span className="text-muted-foreground">
            {u.step} · {calls(u.calls)}
            {u.failed ? ` (${u.failed} failed)` : ''} · {usd(u.cost_usd)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Entry({ entry, last }: { entry: TimelineEntry; last: boolean }) {
  const Icon = entry.tone === 'bad' ? CircleX : ICON[entry.kind];
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span aria-hidden className="absolute top-6 bottom-0 left-[11px] w-px bg-border" />}
      <span
        aria-hidden
        className={cn(
          'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background',
          entry.tone === 'good' && 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
          entry.tone === 'bad' && 'border-destructive/40 text-destructive',
          !entry.tone && 'text-muted-foreground',
          entry.kind === 'run' && !entry.tone && 'border-orange-400/50 text-orange-600 dark:text-orange-300',
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm leading-5">
          {entry.href ? (
            <a href={entry.href} target="_blank" rel="noreferrer" className="font-medium hover:underline">
              {entry.title}
            </a>
          ) : (
            <span className={cn(entry.kind === 'run' && 'font-medium')}>{entry.title}</span>
          )}
          {entry.detail && entry.kind !== 'follow-up' && (
            <span className="text-muted-foreground"> · {entry.detail}</span>
          )}
        </p>
        {entry.detail && entry.kind === 'follow-up' && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{entry.detail}</p>
        )}
        <LocalTime iso={entry.at} format="date-time" className="text-xs text-muted-foreground" />
        {entry.models && <ModelChips uses={entry.models} />}
      </div>
    </li>
  );
}

export function TicketTimeline({ entries, models }: { entries: TimelineEntry[]; models: ModelTotal[] }) {
  const folded = entries.length > SHOWN ? entries.slice(0, entries.length - SHOWN) : [];
  const shown = entries.slice(folded.length);
  return (
    <div className="flex flex-col gap-4">
      {models.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs text-muted-foreground">Models that worked this ticket</h3>
          <ul className="flex flex-col gap-1">
            {models.map((m) => (
              <li key={m.model} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {modelName(m.model)}
                  <span className="text-xs text-muted-foreground"> · {m.steps.join(', ')}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {calls(m.calls)} · {usd(m.cost_usd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
      ) : (
        <div>
          {folded.length > 0 && (
            <details className="group/earlier mb-4">
              <summary className="cursor-pointer list-none text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                <span className="group-open/earlier:hidden">Show {folded.length} earlier</span>
                <span className="hidden group-open/earlier:inline">Hide earlier</span>
              </summary>
              <ol className="mt-3" aria-label="Earlier timeline">
                {folded.map((e, i) => (
                  <Entry key={`${e.at}-${i}`} entry={e} last={false} />
                ))}
              </ol>
            </details>
          )}
          <ol aria-label="Timeline">
            {shown.map((e, i) => (
              <Entry key={`${e.at}-${i}`} entry={e} last={i === shown.length - 1} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
