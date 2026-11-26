// What the agent of a task may reach: one row per service and its access level.
import { Check, Minus, X } from 'lucide-react';
import { type ServiceAccess } from '@factory/core';
import { cn } from '@/lib/utils';

const ACCESS_LOOK = {
  full: { icon: Check, tone: 'text-emerald-600 dark:text-emerald-400', label: 'Full access' },
  limited: { icon: Minus, tone: 'text-amber-600 dark:text-amber-400', label: 'Limited access' },
  none: { icon: X, tone: 'text-muted-foreground', label: 'No access' },
} as const;

/** Which services the task's session can reach. Services with no access share one line. */
export function AccessList({ access }: { access: ServiceAccess[] }) {
  const reachable = access.filter((a) => a.level !== 'none' || a.service === 'GitHub');
  const off = access.filter((a) => a.level === 'none' && a.service !== 'GitHub');
  return (
    <ul className="flex flex-col gap-2.5 text-sm">
      {reachable.map((a) => {
        const look = ACCESS_LOOK[a.level];
        return (
          <li key={a.service} className="flex gap-2">
            <look.icon className={cn('mt-0.5 size-4 shrink-0', look.tone)} aria-label={look.label} />
            <span className="min-w-0">
              <span className="font-medium">{a.service}</span>
              <span className="block text-xs text-muted-foreground">{a.detail}</span>
            </span>
          </li>
        );
      })}
      {off.length > 0 && (
        <li className="flex gap-2">
          <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="No access" />
          <span className="min-w-0">
            <span className="font-medium">Not connected</span>
            <span className="block text-xs text-muted-foreground">
              {off.map((a) => a.service).join(', ')}
            </span>
          </span>
        </li>
      )}
    </ul>
  );
}

/** Issue events and comment threads, oldest first. A thread sorts by its first comment. */
