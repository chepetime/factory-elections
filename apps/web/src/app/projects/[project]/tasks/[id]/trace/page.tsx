import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { TraceNode } from '@factory/core';
import { isProjectName, isTaskId } from '@/lib/factory';
import { getTaskTrace } from '@/lib/trace';
export const dynamic = 'force-dynamic';
const number = (n: number) => n.toLocaleString();
const duration = (n?: number) =>
  n === undefined ? 'Unknown' : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(2)} s`;
const money = (cost: number, unknown = 0) =>
  `${unknown ? '≥ ' : ''}$${cost.toFixed(4)}${unknown ? ` (${unknown} unknown)` : ''}`;
function elapsed(node: TraceNode): { ms: number; unknown: number } {
  return node.children.reduce(
    (sum, child) => {
      const x = elapsed(child);
      return { ms: sum.ms + x.ms, unknown: sum.unknown + x.unknown };
    },
    { ms: node.span.duration_ms ?? 0, unknown: node.span.duration_ms === undefined ? 1 : 0 },
  );
}
function NodeView({ node }: { node: TraceNode }) {
  const { span, total } = node;
  const time = elapsed(node);
  return (
    <li className="space-y-2 border-l-2 border-border pl-4">
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap justify-between gap-2">
          <span className="font-medium">
            {span.name}{' '}
            <span className="text-xs text-muted-foreground">
              {span.type} · {span.outcome}
            </span>
          </span>
          <time className="text-xs text-muted-foreground" dateTime={span.started_at}>
            {span.started_at}
          </time>
        </div>
        <p className="mt-2 text-sm">
          Span: {duration(span.duration_ms)} · {number(span.tokens?.input ?? 0)} input /{' '}
          {number(span.tokens?.output ?? 0)} output tokens ·{' '}
          {span.cost_usd === null
            ? 'Unknown cost'
            : span.cost_usd === undefined
              ? 'No cost'
              : money(span.cost_usd)}
        </p>
        <p className="text-sm text-muted-foreground">
          Subtree: {duration(time.ms)} summed span time{time.unknown ? ` (${time.unknown} unknown)` : ''} ·{' '}
          {number(total.tokens.input)} input / {number(total.tokens.output)} output tokens ·{' '}
          {money(total.cost_usd, total.unknown_cost_spans)}
        </p>
      </div>
      {node.children.length > 0 && (
        <ul className="space-y-2">
          {node.children.map((child) => (
            <NodeView key={child.span.span_id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}
export default async function TracePage({ params }: { params: Promise<{ project: string; id: string }> }) {
  const { project, id } = await params;
  if (!isProjectName(project) || !isTaskId(id)) notFound();
  let trace;
  try {
    trace = await getTaskTrace(project, id);
  } catch {
    return (
      <main className="p-6">
        <p role="alert">Could not load the trace. Try again.</p>
        <Link href={`/projects/${project}/tasks/${id}`} className="underline">
          Back to task
        </Link>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <Link className="text-sm underline" href={`/projects/${project}/tasks/${id}`}>
        Back to task
      </Link>
      <h1 className="text-2xl font-semibold">Run traces</h1>
      <p className="text-sm text-muted-foreground">
        Summed span time includes overlapping parent and child spans.
      </p>
      {trace.roots.length ? (
        <ul className="space-y-4">
          {trace.roots.map((node) => (
            <NodeView key={node.span.span_id} node={node} />
          ))}
        </ul>
      ) : (
        <p>No spans recorded for this task yet.</p>
      )}
    </main>
  );
}
