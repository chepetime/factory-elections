import type { Metadata } from 'next';
import Link from 'next/link';
import { LocalTime } from '@/components/local-time';
import { Empty, PageHeader, Unavailable } from '@/components/system-page';
import { listFindings, type FindingRow } from '@/lib/system';
import { cn } from '@factory/ui/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Findings' };

/** Severities in the order a person should read them; others follow. */
const ORDER = ['critical', 'must-fix', 'blocking', 'major', 'should-fix', 'minor', 'nit'];
const TONE: Record<string, string> = {
  critical: 'bg-destructive/10 text-destructive',
  'must-fix': 'bg-destructive/10 text-destructive',
  blocking: 'bg-destructive/10 text-destructive',
  major: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  'should-fix': 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
};
const rank = (s?: string) => {
  const i = ORDER.indexOf(s ?? '');
  return i < 0 ? ORDER.length : i;
};

/** Each PR review lists its findings; this page lists them over every PR and project. */
export default async function FindingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ severity?: string }>;
}) {
  const { severity } = (await searchParams) ?? {};
  const listed = await listFindings();
  if (!listed.ok)
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Findings" />
        <Unavailable what="Findings" error={listed.error} />
      </div>
    );
  const all = listed.value;
  const counts = new Map<string, number>();
  for (const f of all) counts.set(f.severity ?? 'none', (counts.get(f.severity ?? 'none') ?? 0) + 1);
  const severities = [...counts.keys()].sort((a, b) => rank(a) - rank(b));
  const shown = severity ? all.filter((f) => (f.severity ?? 'none') === severity) : all;
  const byPr = new Map<string, FindingRow[]>();
  for (const f of shown) {
    const key = `${f.project}#${f.number}`;
    byPr.set(key, [...(byPr.get(key) ?? []), f]);
  }
  const chip = (active: boolean) =>
    cn(
      'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm',
      active ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
    );
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Findings">
        What senior PR reviews found, over every project, newest review first. Agent PRs get their critical
        and must-fix findings sent back to the agent before the PR is ready.
      </PageHeader>
      {all.length > 0 && (
        <nav aria-label="Severity" className="flex flex-wrap gap-2">
          <Link href="/findings" className={chip(!severity)} aria-current={!severity ? 'page' : undefined}>
            All <span className="tabular-nums text-muted-foreground">{all.length}</span>
          </Link>
          {severities.map((s) => (
            <Link
              key={s}
              href={`/findings?severity=${encodeURIComponent(s)}`}
              className={chip(severity === s)}
              aria-current={severity === s ? 'page' : undefined}
            >
              {s === 'none' ? 'No severity' : s}{' '}
              <span className="tabular-nums text-muted-foreground">{counts.get(s)}</span>
            </Link>
          ))}
        </nav>
      )}
      {shown.length === 0 ? (
        <Empty>
          {all.length ? 'No findings with this severity.' : 'No saved reviews have findings yet.'}
        </Empty>
      ) : (
        [...byPr.values()].map((rows) => {
          const pr = rows[0]!;
          return (
            <section key={`${pr.project}#${pr.number}`} className="rounded-xl border bg-card shadow-xs">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/projects/${pr.project}/reviews/${pr.number}`}
                    className="font-medium hover:underline"
                  >
                    {pr.title}
                  </Link>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {pr.project} #{pr.number}
                    {pr.decision ? ` · ${pr.decision}` : ''}
                  </span>
                </div>
                <LocalTime iso={pr.at} format="date-time" className="text-xs text-muted-foreground" />
              </header>
              <ul className="divide-y">
                {[...rows]
                  .sort((a, b) => rank(a.severity) - rank(b.severity) || a.index - b.index)
                  .map((f) => (
                    <li key={f.index} className="flex gap-3 px-4 py-3 text-sm">
                      <span
                        className={cn(
                          'h-fit shrink-0 rounded-md px-1.5 py-0.5 text-xs',
                          TONE[f.severity ?? ''] ?? 'bg-muted text-muted-foreground',
                        )}
                      >
                        {f.severity ?? 'note'}
                      </span>
                      <div className="min-w-0">
                        <p>{f.finding}</p>
                        {(f.file || f.axis) && (
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {[f.file && `${f.file}${f.line_range ? `:${f.line_range}` : ''}`, f.axis]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                        {f.fix && <p className="mt-1 text-xs text-muted-foreground">Fix: {f.fix}</p>}
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
