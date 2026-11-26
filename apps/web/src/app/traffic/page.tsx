import type { Metadata } from 'next';
import { cell, DataTable, Empty, PageHeader, Stat, Stats, Unavailable, usd } from '@/components/system-page';
import { formatTokens, getTraffic, type Traffic } from '@/lib/system';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Traffic' };

const DAYS = 14;
type Sum = Traffic['days'][number];
const tokenTotal = (s: Pick<Sum, 'tokens'>) => s.tokens.input + s.tokens.output;

/** One bar per day, for spend; the day with the most spend fills the height. */
function DailyBars({ days, from }: { days: Traffic['days']; from: string }) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const start = Date.parse(from.slice(0, 10));
  const series = Array.from({ length: DAYS + 1 }, (_, i) => {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    return {
      day,
      cost: byDay.get(day)?.cost_usd ?? 0,
      tokens: byDay.get(day) ? tokenTotal(byDay.get(day)!) : 0,
    };
  });
  const max = Math.max(...series.map((d) => d.cost), 0.0001);
  return (
    <figure className="rounded-xl border bg-card px-4 py-3 shadow-xs">
      <figcaption className="text-sm font-medium">Spend per day</figcaption>
      <ol className="mt-3 flex h-32 items-end gap-1" aria-label="Spend per day">
        {series.map((d) => (
          <li
            key={d.day}
            className="group relative flex h-full flex-1 flex-col justify-end"
            aria-label={`${d.day}: ${usd(d.cost)}, ${formatTokens(d.tokens)} tokens`}
          >
            <span
              className="block rounded-t-sm bg-orange-500/80 group-hover:bg-orange-500"
              style={{ height: `${Math.max((d.cost / max) * 100, d.cost > 0 ? 2 : 0)}%` }}
            />
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-[10px] whitespace-nowrap text-background group-hover:block">
              {d.day.slice(5)} · {usd(d.cost)}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{series[0]!.day.slice(5)}</span>
        <span>{series.at(-1)!.day.slice(5)}</span>
      </div>
    </figure>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: Record<string, Pick<Sum, 'cost_usd' | 'tokens'>>;
}) {
  const sorted = Object.entries(rows).sort(([, a], [, b]) => b.cost_usd - a.cost_usd);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {sorted.length === 0 ? (
        <Empty>Nothing recorded.</Empty>
      ) : (
        <DataTable label={title} head={['Name', 'Tokens', 'Cost']}>
          {sorted.map(([name, s]) => (
            <tr key={name}>
              <td className={`${cell} font-mono text-xs`}>{name}</td>
              <td className={`${cell} tabular-nums`}>{formatTokens(tokenTotal(s))}</td>
              <td className={`${cell} tabular-nums`}>{usd(s.cost_usd)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </section>
  );
}

/** What flowed through the factory: spend, tokens, runs and calls over the last two weeks. */
export default async function TrafficPage() {
  const traffic = await getTraffic(DAYS);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Traffic">
        Spend, tokens and calls over every project in the last {DAYS} days, from the span ledger.
      </PageHeader>
      {!traffic.ok ? (
        <Unavailable what="Traffic" error={traffic.error} />
      ) : (
        <>
          <Stats>
            <Stat
              label="Spend"
              value={usd(traffic.value.total.cost_usd)}
              note={
                traffic.value.total.unknown_cost_spans
                  ? `at least; ${traffic.value.total.unknown_cost_spans} calls without a cost`
                  : undefined
              }
            />
            <Stat
              label="Tokens"
              value={formatTokens(tokenTotal(traffic.value.total))}
              note="input + output"
            />
            <Stat
              label="Runs"
              value={traffic.value.runs.count}
              note={`${traffic.value.runs.failed} failed`}
              tone={traffic.value.runs.failed ? 'bad' : undefined}
            />
            <Stat
              label="Tool calls"
              value={traffic.value.reliability.tool_calls}
              note={`${traffic.value.reliability.failed_tool_calls} failed`}
            />
          </Stats>
          <DailyBars days={traffic.value.days} from={traffic.value.from} />
          <div className="grid gap-5 lg:grid-cols-2">
            <Breakdown title="By model" rows={traffic.value.by_model} />
            <Breakdown title="By project" rows={traffic.value.by_project} />
            <Breakdown title="By step" rows={traffic.value.by_step} />
            <Breakdown title="By kind of work" rows={traffic.value.by_type} />
          </div>
        </>
      )}
    </div>
  );
}
