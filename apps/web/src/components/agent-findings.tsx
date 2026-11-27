'use client';

import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CircleAlert,
  Info,
  LoaderCircle,
  ScanSearch,
  X,
} from 'lucide-react';
import { Badge } from '@factory/ui/components/badge';
import { Button } from '@factory/ui/components/button';
import { Card } from '@factory/ui/components/card';
import { cn } from '@factory/ui/lib/utils';

export type FindingAgent = {
  id: string;
  name: string;
  model?: string;
  avatar?: ReactNode;
  step?: string;
  done: number;
  total: number;
  status?: 'running' | 'done' | 'stopped';
};

export type Finding = {
  id: string;
  agentId: string;
  title: string;
  severity: 'critical' | 'warning' | 'note';
  location?: string;
  /** Timestamp in milliseconds; use the same clock for `now`. */
  at: number;
};

type AgentFindingsProps = {
  agents: FindingAgent[];
  findings: Finding[];
  title?: string;
  rows?: number;
  /** A caller-controlled clock keeps relative times deterministic. */
  now?: number;
  onOpen?: (finding: Finding) => void;
  className?: string;
};

const severityStyles = {
  critical: { icon: CircleAlert, className: 'text-red-600 dark:text-red-400', label: 'Critical' },
  warning: { icon: AlertTriangle, className: 'text-amber-700 dark:text-amber-400', label: 'Warning' },
  note: { icon: Info, className: 'text-blue-600 dark:text-blue-400', label: 'Note' },
};

function findingAge(at: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export function AgentFindings({
  agents,
  findings,
  title = 'Verification',
  rows = 4,
  now,
  onOpen,
  className,
}: AgentFindingsProps) {
  const headingId = useId();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const filter = agents.find((agent) => agent.id === selectedAgent);
  // If a selected agent is removed by the caller, show all findings again.
  const filtered = findings
    .filter((finding) => !filter || finding.agentId === filter.id)
    .toSorted((a, b) => b.at - a.at);
  const visible = filtered.slice(0, Math.max(1, Math.floor(rows)));
  const clock = now ?? Math.max(0, ...findings.map((finding) => finding.at));
  const total = agents.reduce((sum, agent) => sum + Math.max(0, agent.total), 0);
  const done = agents.reduce(
    (sum, agent) => sum + Math.min(Math.max(0, agent.done), Math.max(0, agent.total)),
    0,
  );
  const critical = findings.filter((finding) => finding.severity === 'critical').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;

  return (
    <LazyMotion features={domAnimation} strict>
      <Card role="region" aria-labelledby={headingId} className={cn('gap-0 py-0 shadow-sm', className)}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ScanSearch className="size-4 text-blue-500" aria-hidden="true" />
            <h3 id={headingId} className="font-medium">
              {title}
            </h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {done} of {total} checks
            </span>
          </div>
          <div className="flex gap-3 text-xs tabular-nums">
            <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <CircleAlert className="size-3.5" aria-hidden="true" />
              {critical} critical
            </span>
            <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {warnings} {warnings === 1 ? 'warning' : 'warnings'}
            </span>
          </div>
        </div>

        <ul aria-label="Review agents" className="space-y-1 p-2">
          {agents.map((agent) => {
            const totalChecks = Math.max(0, agent.total);
            const completed = Math.min(Math.max(0, agent.done), totalChecks);
            const status = agent.status ?? (totalChecks > 0 && completed >= totalChecks ? 'done' : 'running');
            const progress = totalChecks ? completed / totalChecks : 0;
            const count = findings.filter((finding) => finding.agentId === agent.id).length;
            const selected = filter?.id === agent.id;
            const StatusIcon = status === 'done' ? Check : status === 'stopped' ? X : LoaderCircle;
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedAgent(selected ? null : agent.id)}
                  className={cn(
                    'flex min-h-20 w-full items-center gap-3 rounded-lg px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:bg-muted/60',
                    selected && 'bg-blue-500/5 ring-1 ring-blue-500/25',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground shadow-xs [&>svg]:size-4"
                  >
                    {agent.avatar ?? <ScanSearch />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{agent.name}</span>
                      {agent.model && (
                        <span className="hidden text-xs text-muted-foreground md:inline">{agent.model}</span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {status === 'done'
                        ? 'All checks complete'
                        : status === 'stopped'
                          ? 'Checks stopped'
                          : (agent.step ?? 'Reviewing…')}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="hidden w-24 overflow-hidden rounded-full bg-muted sm:block lg:w-32"
                  >
                    <m.span
                      className={cn(
                        'block h-1.5 origin-left rounded-full',
                        status === 'done'
                          ? 'bg-emerald-500'
                          : status === 'stopped'
                            ? 'bg-muted-foreground'
                            : 'bg-blue-500',
                      )}
                      initial={false}
                      animate={{ scaleX: progress }}
                      transition={{ duration: reduceMotion ? 0 : 0.25 }}
                    />
                  </span>
                  <span
                    aria-hidden="true"
                    className="hidden w-12 text-right font-mono text-xs text-muted-foreground min-[480px]:block"
                  >
                    {completed}/{totalChecks}
                  </span>
                  <StatusIcon
                    aria-hidden="true"
                    className={cn(
                      'size-3.5 shrink-0 text-muted-foreground',
                      status === 'running' && 'motion-safe:animate-spin',
                      status === 'done' && 'text-emerald-600 dark:text-emerald-400',
                    )}
                  />
                  <span className="sr-only">
                    {status}. {completed} of {totalChecks} checks. {count}{' '}
                    {count === 1 ? 'finding' : 'findings'}.{' '}
                    {selected ? 'Show all findings' : 'Filter findings'}.
                  </span>
                  <Badge variant="secondary" aria-hidden="true" className="min-w-7 tabular-nums">
                    {count}
                  </Badge>
                </button>
              </li>
            );
          })}
        </ul>
        {agents.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No agents assigned yet.</p>
        )}

        <div className="border-t">
          <div className="flex min-h-14 items-center justify-between gap-2 px-5">
            <h4 className="text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
              {filter ? `${filter.name} findings` : 'Latest findings'}
            </h4>
            {filter && (
              <Button variant="ghost" className="min-h-11 text-xs" onClick={() => setSelectedAgent(null)}>
                Show all
                <X className="size-3" />
              </Button>
            )}
          </div>
          <p role="status" className="sr-only">
            {filter ? `${filter.name}: ` : ''}
            {filtered.length} findings. {critical} critical, {warnings} warnings across the review.
          </p>
          <ul
            aria-live="polite"
            aria-relevant="additions text"
            aria-label={filter ? `Findings from ${filter.name}` : 'Latest findings'}
            className="space-y-1 px-2 pb-2"
          >
            <AnimatePresence initial={false} mode="popLayout">
              {visible.map((finding) => {
                const severity = severityStyles[finding.severity];
                const Icon = severity.icon;
                const agent = agents.find((item) => item.id === finding.agentId);
                const content = (
                  <>
                    <Icon aria-hidden="true" className={cn('size-4 shrink-0', severity.className)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{finding.title}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={severity.className}>{severity.label}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{agent?.name ?? 'Unknown agent'}</span>
                        {finding.location && (
                          <code className="hidden truncate min-[480px]:inline">· {finding.location}</code>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {findingAge(finding.at, clock)}
                    </span>
                    {onOpen && (
                      <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                  </>
                );
                return (
                  <m.li
                    key={finding.id}
                    layout={!reduceMotion}
                    initial={reduceMotion ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.2 }}
                  >
                    {onOpen ? (
                      <button
                        type="button"
                        onClick={() => onOpen(finding)}
                        className="flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:bg-muted/60"
                      >
                        {content}
                      </button>
                    ) : (
                      <div className="flex min-h-16 items-center gap-3 px-3 py-3">{content}</div>
                    )}
                  </m.li>
                );
              })}
            </AnimatePresence>
          </ul>
          {visible.length === 0 && (
            <p className="px-5 pb-8 pt-3 text-center text-sm text-muted-foreground">
              {filter ? 'No findings from this agent yet.' : 'No findings yet. Checks are in progress.'}
            </p>
          )}
          {filtered.length > visible.length && (
            <p className="border-t px-5 py-3 text-xs text-muted-foreground">
              Showing the latest {visible.length} of {filtered.length} findings.
            </p>
          )}
        </div>
      </Card>
    </LazyMotion>
  );
}
