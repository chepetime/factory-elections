import { notFound } from 'next/navigation';
import { isProjectName } from '@/lib/factory';
import { getWeekly } from '@/lib/weekly';
export const dynamic = 'force-dynamic';
const n = (value: number) => value.toLocaleString();
const pct = (value?: number) => (value === undefined ? '—' : `${(value * 100).toFixed(1)}%`);
const money = (value?: number, unknown = 0) =>
  value === undefined
    ? '—'
    : `${unknown ? '≥ ' : ''}$${value.toFixed(2)}${unknown ? ` (${unknown} unknown)` : ''}`;
const time = (value?: number) => (value === undefined ? '—' : `${(value / 60_000).toFixed(1)} min`);
export default async function WeeklyPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  let data;
  try {
    data = await getWeekly(project);
  } catch {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Weekly</h1>
        <p role="alert" className="mt-4">
          Could not load metrics. Try again.
        </p>
      </main>
    );
  }
  const { runs, prs, reliability: r } = data;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Weekly</h1>
        <p className="text-sm text-muted-foreground">
          {data.from} to {data.to} · {project}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <section className="rounded-xl border p-4">
          <h2 className="text-sm text-muted-foreground">Spend</h2>
          <p className="text-xl font-semibold">{money(data.total.cost_usd, data.total.unknown_cost_spans)}</p>
        </section>
        <section className="rounded-xl border p-4">
          <h2 className="text-sm text-muted-foreground">Median cost per PR</h2>
          <p className="text-xl font-semibold">{money(prs.median_cost_usd)}</p>
          <p className="text-xs text-muted-foreground">{n(prs.count)} PRs</p>
        </section>
        <section className="rounded-xl border p-4">
          <h2 className="text-sm text-muted-foreground">Median run time per PR</h2>
          <p className="text-xl font-semibold">{time(prs.median_run_ms)}</p>
        </section>
      </div>
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">Spend and tokens per day</h2>
        {data.days.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Date (UTC)</th>
                  <th>Spend</th>
                  <th>Input tokens</th>
                  <th>Output tokens</th>
                  <th>Cache read</th>
                  <th>Cache write</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.day} className="border-t">
                    <td className="py-2">{d.day}</td>
                    <td>{money(d.cost_usd, d.unknown_cost_spans)}</td>
                    <td>{n(d.tokens.input)}</td>
                    <td>{n(d.tokens.output)}</td>
                    <td>{n(d.tokens.cache_read)}</td>
                    <td>{n(d.tokens.cache_write)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No spans recorded in this period.</p>
        )}
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">Reliability</h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt>First-pass rate</dt>
            <dd>{pct(runs.first_pass_rate)}</dd>
          </div>
          <div>
            <dt>Run failure rate</dt>
            <dd>
              {pct(runs.failure_rate)} ({n(runs.failed)}/{n(runs.count)})
            </dd>
          </div>
          <div>
            <dt>Model climb rate</dt>
            <dd>{pct(runs.climb_rate)}</dd>
          </div>
          <div>
            <dt>Tool failure rate</dt>
            <dd>
              {pct(r.tool_calls ? r.failed_tool_calls / r.tool_calls : undefined)} ({n(r.failed_tool_calls)}/
              {n(r.tool_calls)})
            </dd>
          </div>
          <div>
            <dt>Stalls</dt>
            <dd>{n(r.stalls)}</dd>
          </div>
          <div>
            <dt>Repeat loops</dt>
            <dd>{n(r.repeat_loops)}</dd>
          </div>
        </dl>
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">Call grading</h2>
        {data.call_grading.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Task class</th>
                  <th>First model</th>
                  <th>Runs</th>
                  <th>First pass</th>
                  <th>Climbed</th>
                  <th>Spend</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                {data.call_grading.map((g) => (
                  <tr key={`${g.task_class}:${g.first_model}`} className="border-t">
                    <td className="py-2">{g.task_class}</td>
                    <td>{g.first_model}</td>
                    <td>{n(g.runs)}</td>
                    <td>{n(g.first_pass)}</td>
                    <td>{n(g.climbed)}</td>
                    <td>{money(g.cost_usd)}</td>
                    <td>{g.grade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No graded calls in this period.</p>
        )}
      </section>
    </main>
  );
}
