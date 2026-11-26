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
} from '@/components/system-page';
import { formatDuration, listSpans, spanHref } from '@/lib/system';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Tool execution' };

/** Every tool call agents made, newest first, from the span ledger. */
export default async function ToolCallsPage() {
  const spans = await listSpans('tool');
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Tool execution">
        The tool calls agents made in the last 14 days, over every project. Open a row to see it in its
        run&apos;s trace.
      </PageHeader>
      {!spans.ok ? (
        <Unavailable what="Tool calls" error={spans.error} />
      ) : (
        <>
          <Stats>
            <Stat label="Tool calls" value={spans.value.total} />
            <Stat
              label="Failed"
              value={spans.value.failed}
              tone={spans.value.failed ? 'bad' : undefined}
              note={
                spans.value.total
                  ? `${Math.round((spans.value.failed / spans.value.total) * 100)}%`
                  : undefined
              }
            />
            <Stat
              label="Tools used"
              value={new Set(spans.value.items.map((s) => s.name)).size}
              note="in the rows below"
            />
            <Stat label="Shown" value={spans.value.items.length} note="newest first" />
          </Stats>
          {spans.value.items.length === 0 ? (
            <Empty>No tool calls in the last 14 days.</Empty>
          ) : (
            <DataTable label="Tool calls" head={['When', 'Tool', 'Input', 'Where', 'Took', 'Result']}>
              {spans.value.items.map((s) => {
                const href = spanHref(s);
                const input = typeof s.attributes?.input === 'string' ? s.attributes.input : undefined;
                return (
                  <tr key={`${s.project}/${s.trace_id}/${s.span_id}`}>
                    <td className={`${cell} whitespace-nowrap text-muted-foreground`}>
                      <LocalTime iso={s.ended_at} format="date-time" />
                    </td>
                    <td className={`${cell} font-mono text-xs`}>{s.name}</td>
                    <td className={`${cell} max-w-80`}>
                      <span className="line-clamp-2 font-mono text-xs break-all text-muted-foreground">
                        {input ?? '—'}
                      </span>
                      {s.error && (
                        <span className="mt-1 line-clamp-2 block text-xs text-destructive">{s.error}</span>
                      )}
                    </td>
                    <td className={`${cell} whitespace-nowrap`}>
                      {href ? (
                        <Link href={href} className="hover:underline">
                          {s.project}
                          {s.step ? ` · ${s.step}` : ''}
                        </Link>
                      ) : (
                        s.project
                      )}
                    </td>
                    <td className={`${cell} whitespace-nowrap tabular-nums`}>
                      {formatDuration(s.duration_ms)}
                    </td>
                    <td className={cell}>
                      <OutcomeBadge outcome={s.outcome} />
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
