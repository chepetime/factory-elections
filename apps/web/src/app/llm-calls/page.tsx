import type { Metadata } from 'next';
import Link from 'next/link';
import { LocalTime } from '@/components/local-time';
import {
  cell,
  DataTable,
  Empty,
  OutcomeBadge,
  PageHeader,
  Stat,
  Stats,
  Unavailable,
  usd,
} from '@/components/system-page';
import { formatDuration, formatTokens, listSpans, spanHref } from '@/lib/system';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'LLM recording' };

/** Every model call the factory recorded, with its model, tokens and cost. */
export default async function LlmCallsPage() {
  const spans = await listSpans('model');
  const items = spans.ok ? spans.value.items : [];
  const cost = items.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
  const unknown = items.filter((s) => s.cost_usd === null).length;
  const tokens = items.reduce((sum, s) => sum + (s.tokens?.input ?? 0) + (s.tokens?.output ?? 0), 0);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="LLM recording">
        Each model call of the last 14 days: the model, the step it ran for, its tokens and its cost. Open a
        row to see the call in its run&apos;s trace, with what it was asked.
      </PageHeader>
      {!spans.ok ? (
        <Unavailable what="Model calls" error={spans.error} />
      ) : (
        <>
          <Stats>
            <Stat label="Model calls" value={spans.value.total} />
            <Stat label="Failed" value={spans.value.failed} tone={spans.value.failed ? 'bad' : undefined} />
            <Stat label="Tokens, shown rows" value={formatTokens(tokens)} note="input + output" />
            <Stat
              label="Cost, shown rows"
              value={usd(cost)}
              note={unknown ? `${unknown} without a reported cost` : undefined}
            />
          </Stats>
          {items.length === 0 ? (
            <Empty>No model calls in the last 14 days.</Empty>
          ) : (
            <DataTable
              label="Model calls"
              head={['When', 'Model', 'Step', 'Where', 'Tokens in / out', 'Cost', 'Took', 'Result']}
            >
              {items.map((s) => {
                const href = spanHref(s);
                return (
                  <tr key={`${s.project}/${s.trace_id}/${s.span_id}`}>
                    <td className={`${cell} whitespace-nowrap text-muted-foreground`}>
                      <LocalTime iso={s.ended_at} format="date-time" />
                    </td>
                    <td className={`${cell} font-mono text-xs`}>{s.model ?? s.name}</td>
                    <td className={cell}>{s.step ?? '—'}</td>
                    <td className={`${cell} whitespace-nowrap`}>
                      {href ? (
                        <Link href={href} className="hover:underline">
                          {s.project}
                        </Link>
                      ) : (
                        s.project
                      )}
                    </td>
                    <td className={`${cell} whitespace-nowrap tabular-nums`}>
                      {s.tokens ? `${formatTokens(s.tokens.input)} / ${formatTokens(s.tokens.output)}` : '—'}
                    </td>
                    <td className={`${cell} tabular-nums`}>
                      {s.cost_usd === null ? 'unknown' : s.cost_usd === undefined ? '—' : usd(s.cost_usd)}
                    </td>
                    <td className={`${cell} whitespace-nowrap tabular-nums`}>
                      {formatDuration(s.duration_ms)}
                    </td>
                    <td className={cell}>
                      <OutcomeBadge outcome={s.outcome} />
                      {s.error && (
                        <span className="mt-1 line-clamp-2 block text-xs text-destructive">{s.error}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </>
      )}
    </div>
  );
}
