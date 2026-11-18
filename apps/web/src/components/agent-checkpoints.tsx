'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react';
import { Check, GitBranch, History, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type Checkpoint = {
  id: string;
  parent?: string;
  title: string;
  status?: 'done' | 'running' | 'failed' | 'stopped';
  at?: number;
  files?: number;
  cost?: number;
  icon?: ReactNode;
};

type AgentCheckpointsProps = {
  /** Chronological order; parents must precede their children. IDs must be unique. */
  checkpoints: Checkpoint[];
  head?: string;
  title?: string;
  mode?: 'checkpoints' | 'timeline';
  task?: string;
  onRewind?: (checkpoint: Checkpoint) => void;
  formatTime?: (ms: number) => string;
  formatCost?: (amount: number) => string;
  className?: string;
};

const elapsed = (ms: number) =>
  `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
const dollars = (amount: number) => `$${amount.toFixed(2)}`;

// Each additional child keeps its own lane, so earlier attempts never move on rewind.
export function checkpointGraph(checkpoints: Checkpoint[], head?: string) {
  const nodes = new Map<string, { checkpoint: Checkpoint; index: number; lane: number }>();
  const parentsWithChildren = new Set<string>();
  let nextLane = 0;
  checkpoints.forEach((checkpoint, index) => {
    const parent = checkpoint.parent ? nodes.get(checkpoint.parent) : undefined;
    const lane = parent && !parentsWithChildren.has(parent.checkpoint.id) ? parent.lane : nextLane++;
    if (parent) parentsWithChildren.add(parent.checkpoint.id);
    nodes.set(checkpoint.id, { checkpoint, index, lane });
  });
  const active = new Set<string>();
  let current = head ?? checkpoints.at(-1)?.id;
  while (current && !active.has(current)) {
    active.add(current);
    current = nodes.get(current)?.checkpoint.parent;
  }
  return { nodes, active, lanes: nextLane };
}

export function AgentCheckpoints({
  checkpoints,
  head = checkpoints.at(-1)?.id,
  title = 'Checkpoints',
  mode = 'checkpoints',
  task,
  onRewind,
  formatTime = elapsed,
  formatCost = dollars,
  className,
}: AgentCheckpointsProps) {
  const headingId = useId();
  const [focusedId, setFocusedId] = useState(head);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scrollRef.current;
    const row = head ? rowRefs.current.get(head) : undefined;
    if (!container || !row) return;
    const top = row.offsetTop;
    if (top < container.scrollTop || top + 72 > container.scrollTop + container.clientHeight) {
      container.scrollTop = Math.max(0, top + 72 - container.clientHeight);
    }
  }, [head]);
  const { nodes, active, lanes } = checkpointGraph(checkpoints, head);
  const totalCost = checkpoints.reduce((total, checkpoint) => total + (checkpoint.cost ?? 0), 0);
  const tabStop = checkpoints.some((checkpoint) => checkpoint.id === focusedId) ? focusedId : head;
  const graphWidth = Math.max(56, lanes * 20 + 20);
  const x = (lane: number) => 24 + lane * 20;

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = {
      ArrowDown: Math.min(index + 1, checkpoints.length - 1),
      ArrowUp: Math.max(index - 1, 0),
      Home: 0,
      End: checkpoints.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const checkpoint = checkpoints[next];
    if (!checkpoint) return;
    const id = checkpoint.id;
    setFocusedId(id);
    rowRefs.current.get(id)?.focus({ preventScroll: true });
    rowRefs.current.get(id)?.scrollIntoView({ block: 'nearest' });
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <Card className={cn('gap-0 py-0 shadow-sm', className)} role="region" aria-labelledby={headingId}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <History aria-hidden="true" className="size-4 text-muted-foreground" />
            <h3 id={headingId} className="font-medium">
              {title}
            </h3>
            {task && <span className="hidden truncate text-xs text-muted-foreground sm:block">/ {task}</span>}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
            <span aria-live="polite" aria-atomic="true">
              {checkpoints.length} {mode === 'timeline' ? 'stages' : 'checkpoints'}
            </span>
            {checkpoints.some((checkpoint) => checkpoint.cost !== undefined) && (
              <span className="border-l pl-3">{formatCost(totalCost)}</span>
            )}
          </div>
        </div>

        {checkpoints.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">
            {mode === 'timeline'
              ? 'Stages will appear as the agent works.'
              : 'Checkpoints will appear as the agent works.'}
          </p>
        ) : (
          <div ref={scrollRef} className="max-h-[1008px] overflow-auto overscroll-contain py-3">
            <div className="relative isolate" style={{ minWidth: graphWidth + 200 }}>
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute top-0 left-0 h-full"
                width={graphWidth}
              >
                {checkpoints.map((checkpoint) => {
                  const node = nodes.get(checkpoint.id)!;
                  const parent = checkpoint.parent ? nodes.get(checkpoint.parent) : undefined;
                  if (!parent) return null;
                  const startY = parent.index * 72 + 36;
                  const endY = node.index * 72 + 36;
                  return (
                    <m.path
                      key={checkpoint.id}
                      d={
                        parent.lane === node.lane
                          ? `M ${x(parent.lane)} ${startY} V ${endY}`
                          : `M ${x(parent.lane)} ${startY} C ${x(parent.lane)} ${startY + 24}, ${x(node.lane)} ${startY + 24}, ${x(node.lane)} ${startY + 48} V ${endY}`
                      }
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={active.has(checkpoint.id) ? 'text-blue-500' : 'text-border'}
                      initial={false}
                      animate={{ opacity: active.has(checkpoint.id) ? 1 : 0.65 }}
                      transition={{ duration: reduceMotion ? 0 : 0.2 }}
                    />
                  );
                })}
              </svg>
              <ol
                aria-label={mode === 'timeline' ? 'Stage timeline' : 'Run checkpoints'}
                className="relative"
              >
                {checkpoints.map((checkpoint, index) => {
                  const node = nodes.get(checkpoint.id)!;
                  const isActive = active.has(checkpoint.id);
                  const isHead = checkpoint.id === head;
                  const status = checkpoint.status ?? 'done';
                  const canRewind = Boolean(onRewind) && !isHead;
                  const StatusIcon =
                    status === 'failed'
                      ? X
                      : status === 'running'
                        ? LoaderCircle
                        : status === 'stopped'
                          ? RotateCcw
                          : Check;
                  return (
                    <m.li
                      key={checkpoint.id}
                      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: reduceMotion ? 0 : 0.2 }}
                      className="relative h-[72px]"
                    >
                      <span
                        aria-hidden="true"
                        style={{ left: x(node.lane) - 9, top: 27 }}
                        className={cn(
                          'pointer-events-none absolute z-10 flex size-[18px] items-center justify-center rounded-full border-2 bg-card',
                          isActive
                            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'border-border text-muted-foreground',
                          isHead && 'ring-4 ring-blue-500/10',
                        )}
                      >
                        <StatusIcon
                          className={cn('size-2.5', status === 'running' && 'motion-safe:animate-spin')}
                        />
                      </span>
                      <button
                        ref={(element) => {
                          if (element) rowRefs.current.set(checkpoint.id, element);
                          else rowRefs.current.delete(checkpoint.id);
                        }}
                        type="button"
                        tabIndex={checkpoint.id === tabStop ? 0 : -1}
                        aria-current={isHead ? 'step' : undefined}
                        aria-disabled={!canRewind}
                        onFocus={() => setFocusedId(checkpoint.id)}
                        onKeyDown={(event) => navigate(event, index)}
                        onClick={() => {
                          if (canRewind) onRewind?.(checkpoint);
                        }}
                        className={cn(
                          'group flex h-full w-full items-center gap-3 pr-4 text-left outline-none transition-colors focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                          canRewind && 'cursor-pointer [@media(hover:hover)]:hover:bg-muted/60',
                          isHead && 'bg-blue-500/5',
                        )}
                        style={{ paddingLeft: graphWidth }}
                      >
                        <span className="sr-only">{status}. </span>
                        <div className={cn('min-w-0 flex-1', !isActive && 'text-muted-foreground')}>
                          <div className="flex items-center gap-2">
                            {checkpoint.icon && (
                              <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">
                                {checkpoint.icon}
                              </span>
                            )}
                            <span className="truncate text-sm font-medium">{checkpoint.title}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            {mode === 'checkpoints' && (
                              <>
                                <span>Attempt {node.lane + 1}</span>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {isHead
                                    ? 'Current checkpoint'
                                    : !isActive
                                      ? 'Previous attempt'
                                      : 'Saved checkpoint'}
                                </span>
                              </>
                            )}
                            {mode === 'timeline' && <span>{isHead ? 'Latest stage' : 'Earlier stage'}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {status !== 'done' && (
                            <Badge
                              variant={status === 'failed' ? 'destructive' : 'secondary'}
                              className="capitalize"
                            >
                              {status}
                            </Badge>
                          )}
                          <span className="hidden text-xs text-muted-foreground tabular-nums sm:block">
                            {checkpoint.files !== undefined && (
                              <span className="mr-3 hidden md:inline">{checkpoint.files} files</span>
                            )}
                            {checkpoint.at !== undefined && formatTime(checkpoint.at)}
                          </span>
                          {canRewind && (
                            <span className="flex min-h-11 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground group-focus-visible:text-foreground">
                              <RotateCcw aria-hidden="true" className="size-3" />
                              <span className="hidden sm:inline">Rewind</span>
                            </span>
                          )}
                        </div>
                      </button>
                    </m.li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <GitBranch aria-hidden="true" className="size-3.5" />
            Earlier attempts stay in your history
          </span>
          <span>↑ ↓ navigate · Enter to rewind</span>
        </div>
      </Card>
    </LazyMotion>
  );
}
