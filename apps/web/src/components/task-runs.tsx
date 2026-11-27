// The task panel's run list: one row per run with its stage and cost, and PR labels.
import Link from 'next/link';
import { stageLabel, statusFromStage, type TaskRecord } from '@factory/core';
import { STATUS } from '@/components/task-status';
import { money } from '@/components/task-run';
import { cn } from '@factory/ui/lib/utils';

export function prLabel(url: string): string {
  const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return m ? `${m[1]}#${m[2]}` : url;
}

/** Known spend across runs; a run with an unpriced attempt marks the total as partial. */
export function totalCost(records: TaskRecord[]): string | undefined {
  const attempts = records.flatMap((r) => r.attempts ?? []);
  if (!attempts.length) return undefined;
  const sum = attempts.reduce((total, a) => total + (a.cost_usd ?? 0), 0);
  return `${attempts.some((a) => a.cost_usd === null) ? 'at least ' : ''}$${sum.toFixed(2)}`;
}

export function RunRow({
  href,
  index,
  record,
  current,
  latest,
}: {
  href: string;
  index: number;
  record: TaskRecord | undefined;
  current: boolean;
  latest: boolean;
}) {
  const look = record ? STATUS[statusFromStage(record.stage)] : undefined;
  const Icon = look?.icon;
  return (
    <li>
      <Link
        href={href}
        aria-current={current ? 'true' : undefined}
        className={cn(
          '-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted',
          current && 'bg-muted',
        )}
      >
        {Icon ? (
          <Icon className={cn('size-4 shrink-0', look.tone)} aria-hidden />
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <span className={cn('shrink-0', current && 'font-medium')}>Run {index}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {record ? stageLabel(record.stage) : 'Unavailable'}
          {latest && ' · latest'}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{record ? money(record) : ''}</span>
      </Link>
    </li>
  );
}
