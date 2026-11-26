// Shared parts of the Functions and System pages: a header, number tiles, a table frame, and the
// empty and error states. Server components; no state.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  children,
  aside,
}: {
  title: string;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{children}</p>}
      </div>
      {aside}
    </header>
  );
}

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'bad';
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-xs">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums', tone === 'bad' && 'text-destructive')}>
        {value}
      </p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>;
}

/** A bordered, horizontally scrolling table with a caption for screen readers. */
export function DataTable({ label, head, children }: { label: string; head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

export const cell = 'px-3 py-2 align-top';

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function Unavailable({ what, error }: { what: string; error: string }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {what} unavailable: {error}
    </p>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-md px-1.5 py-0.5 text-xs',
        outcome === 'completed'
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'bg-destructive/10 text-destructive',
      )}
    >
      {outcome === 'completed' ? 'Done' : outcome === 'aborted' ? 'Stopped' : 'Failed'}
    </span>
  );
}

export const usd = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);
