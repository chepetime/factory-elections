import {
  Ban,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Eye,
  type LucideIcon,
} from 'lucide-react';
import type { IssueStatus } from '@factory/core';
import { cn } from '@factory/ui/lib/utils';

/** Board columns and task statuses: one icon and color each, shared by the board and the task page. */
export const STATUS: Record<IssueStatus, { label: string; icon: LucideIcon; tone: string }> = {
  backlog: { label: 'Backlog', icon: CircleDashed, tone: 'text-muted-foreground' },
  todo: { label: 'Todo', icon: Circle, tone: 'text-foreground' },
  in_progress: { label: 'In progress', icon: CircleDot, tone: 'text-amber-600 dark:text-amber-400' },
  in_review: { label: 'In review', icon: Eye, tone: 'text-blue-600 dark:text-blue-400' },
  done: { label: 'Done', icon: CircleCheck, tone: 'text-emerald-600 dark:text-emerald-400' },
  blocked: { label: 'Blocked', icon: Ban, tone: 'text-destructive' },
  cancelled: { label: 'Cancelled', icon: CircleX, tone: 'text-muted-foreground' },
};

export function StatusLabel({ status, className }: { status: IssueStatus; className?: string }) {
  const { label, icon: Icon, tone } = STATUS[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Icon className={cn('size-4 shrink-0', tone)} aria-hidden />
      {label}
    </span>
  );
}
