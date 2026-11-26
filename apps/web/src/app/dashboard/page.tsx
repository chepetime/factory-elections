import type { Metadata } from 'next';
import Link from 'next/link';
import { Inbox } from '@/components/inbox';
import { PageHeader, Stat, Stats, usd } from '@/components/system-page';
import { getInbox } from '@/lib/inbox';
import { withTaskKeys } from '@/lib/issues';
import { formatTokens, getTraffic, listFindings } from '@/lib/system';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dashboard' };

const URGENT = new Set(['critical', 'must-fix', 'blocking']);

/** What needs you now over every project, and the key numbers of the last week. */
export default async function DashboardPage() {
  const [inbox, traffic, findings] = await Promise.all([getInbox(), getTraffic(7), listFindings()]);
  const items = inbox.ok ? await withTaskKeys(inbox.value.items) : undefined;
  const t = traffic.ok ? traffic.value : undefined;
  const urgent = findings.ok ? findings.value.filter((f) => URGENT.has(f.severity ?? '')).length : undefined;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Dashboard">
        What needs you over every project, and the numbers of the last 7 days.
      </PageHeader>
      <Stats>
        <Stat label="Needs you" value={items?.length ?? '—'} tone={items?.length ? 'bad' : undefined} />
        <Stat
          label="Runs, 7 days"
          value={t?.runs.count ?? '—'}
          note={t ? `${t.runs.failed} failed` : 'unavailable'}
          tone={t?.runs.failed ? 'bad' : undefined}
        />
        <Stat
          label="Spend, 7 days"
          value={t ? usd(t.total.cost_usd) : '—'}
          note={t ? `${formatTokens(t.total.tokens.input + t.total.tokens.output)} tokens` : 'unavailable'}
        />
        <Stat
          label="Urgent findings"
          value={
            urgent === undefined ? (
              '—'
            ) : (
              <Link href="/findings" className="hover:underline">
                {urgent}
              </Link>
            )
          }
          note="critical or must-fix"
          tone={urgent ? 'bad' : undefined}
        />
      </Stats>
      <Inbox items={items} error={!inbox.ok} />
      <nav aria-label="More" className="flex flex-wrap gap-4 text-sm">
        <Link href="/traffic" className="text-muted-foreground hover:text-foreground hover:underline">
          Traffic
        </Link>
        <Link href="/tool-calls" className="text-muted-foreground hover:text-foreground hover:underline">
          Tool execution
        </Link>
        <Link href="/llm-calls" className="text-muted-foreground hover:text-foreground hover:underline">
          LLM recording
        </Link>
      </nav>
    </div>
  );
}
