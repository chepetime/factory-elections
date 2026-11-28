'use client';
// The /network map: each part of the installation as a card, the links between them as curves.
// Live links carry moving dots and grow with their call count; selecting a part lights its links and
// opens its details. Original design, inspired by Affect UI's Agent Graph and Agent Overlap Map
// (https://www.affectui.com/components/agent-graph); no Affect UI source.
import { Bot, Database, Monitor, Server, SquareTerminal, Workflow, type LucideIcon } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import type {
  EdgeStatus,
  NetworkEdge,
  NetworkNode,
  NetworkSnapshot,
  NodeKind,
  NodeStatus,
} from '@/lib/network';
import { ProviderId } from '@factory/core';
import { ProviderIcon } from '@/components/provider-icon';
import { cn } from '@factory/ui/lib/utils';

const POLL_MS = 5000;
/** The drawing's own coordinates; the box keeps this aspect, so the curves meet the cards. */
const VIEW = { w: 1000, h: 560 } as const;
const PLACE: Record<string, { x: number; y: number }> = {
  harness: { x: 500, y: 70 },
  client: { x: 150, y: 200 },
  cli: { x: 150, y: 400 },
  backend: { x: 500, y: 280 },
  data: { x: 500, y: 485 },
  claude: { x: 850, y: 130 },
  codex: { x: 850, y: 280 },
  pi: { x: 850, y: 430 },
};

const ICON: Record<NodeKind, LucideIcon> = {
  client: Monitor,
  cli: SquareTerminal,
  backend: Server,
  data: Database,
  agent: Bot,
  harness: Workflow,
};

/** The word always shows with the color, so status never rests on color alone. */
const STATUS: Record<NodeStatus, { word: string; dot: string }> = {
  ok: { word: 'Ready', dot: 'bg-emerald-500' },
  working: { word: 'Working', dot: 'bg-sky-500' },
  waiting: { word: 'Needs you', dot: 'bg-amber-500' },
  limited: { word: 'Limited', dot: 'bg-amber-500' },
  error: { word: 'Down', dot: 'bg-destructive' },
  off: { word: 'Off', dot: 'bg-muted-foreground/50' },
  unknown: { word: 'Unknown', dot: 'bg-muted-foreground/50' },
};

const EDGE: Record<EdgeStatus, string> = {
  live: 'stroke-foreground/45',
  idle: 'stroke-foreground/20',
  down: 'stroke-destructive/60',
  unmeasured: 'stroke-foreground/25 [stroke-dasharray:5_6]',
};

/** A curve leaving and entering horizontally for side links, vertically for links above and below. */
function curve(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy))
    return `M${from.x} ${from.y} C${from.x + dx / 2} ${from.y} ${from.x + dx / 2} ${to.y} ${to.x} ${to.y}`;
  return `M${from.x} ${from.y} C${from.x} ${from.y + dy / 2} ${to.x} ${from.y + dy / 2} ${to.x} ${to.y}`;
}

function useLiveSnapshot(initial: NetworkSnapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/network', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as NetworkSnapshot;
        if (!stopped) {
          setSnapshot(next);
          setOffline(false);
        }
      } catch {
        if (!stopped) setOffline(true);
      }
    };
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  return { snapshot, offline };
}

function Link({
  edge,
  max,
  faded,
  lit,
  motion,
}: {
  edge: NetworkEdge;
  max: number;
  faded: boolean;
  lit: boolean;
  motion: boolean;
}) {
  const from = PLACE[edge.from];
  const to = PLACE[edge.to];
  if (!from || !to) return null;
  const d = curve(from, to);
  const width = 1.25 + (max > 0 ? (edge.calls / max) * 2.75 : 0);
  // One dot for a live link, more as calls grow; a failed call sends one red dot.
  const dots = edge.status === 'live' ? Math.min(4, 1 + Math.floor(edge.calls / 5)) : 0;
  const seconds = Math.max(1.4, 3.2 - edge.calls / 10);
  return (
    <g className={cn('motion-safe:transition-opacity', faded && 'opacity-25')}>
      <path
        d={d}
        fill="none"
        strokeWidth={lit ? width + 0.75 : width}
        strokeLinecap="round"
        className={cn(EDGE[edge.status], lit && edge.status !== 'down' && 'stroke-foreground/70')}
      />
      {motion &&
        Array.from({ length: dots }, (_, i) => (
          <circle key={i} r={2.6} className="fill-foreground/70">
            <animateMotion
              dur={`${seconds}s`}
              begin={`${(i * seconds) / dots}s`}
              repeatCount="indefinite"
              path={d}
            />
          </circle>
        ))}
      {motion && edge.status === 'live' && edge.failed > 0 && (
        <circle r={3} className="fill-destructive">
          <animateMotion
            dur={`${seconds * 1.3}s`}
            repeatCount="indefinite"
            path={d}
            keyPoints="1;0"
            keyTimes="0;1"
          />
        </circle>
      )}
    </g>
  );
}

function Card({
  node,
  selected,
  faded,
  panel,
  onSelect,
  onHover,
}: {
  node: NetworkNode;
  selected: boolean;
  faded: boolean;
  panel: string;
  onSelect: () => void;
  onHover: (on: boolean) => void;
}) {
  const place = PLACE[node.id];
  if (!place) return null;
  const Icon = ICON[node.kind];
  const provider = ProviderId.safeParse(node.id);
  const status = STATUS[node.status];
  return (
    <button
      type="button"
      aria-expanded={selected}
      aria-controls={panel}
      onClick={onSelect}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      style={{ left: `${(place.x / VIEW.w) * 100}%`, top: `${(place.y / VIEW.h) * 100}%` }}
      className={cn(
        'absolute flex w-44 -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-xl border bg-card px-3 py-2 text-left shadow-xs outline-offset-2 motion-safe:transition-[opacity,box-shadow] focus-visible:outline-2 focus-visible:outline-ring',
        selected && 'ring-2 ring-ring',
        // Fade the content, not the card: a see-through card shows the links behind it.
        faded && '[&>*]:opacity-40',
        (node.status === 'off' || node.status === 'unknown') && 'border-dashed',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {provider.success ? (
          <ProviderIcon provider={provider.data} />
        ) : (
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 truncate text-sm font-medium">{node.name}</span>
      </span>
      <span className="truncate text-xs text-muted-foreground">{node.detail}</span>
      <span className="flex items-center gap-1.5 text-xs">
        <span aria-hidden className="relative flex size-2">
          {node.status === 'working' && (
            <span
              className={cn('absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping', status.dot)}
            />
          )}
          <span className={cn('relative size-2 rounded-full', status.dot)} />
        </span>
        {status.word}
      </span>
    </button>
  );
}

export function SystemNetwork({ initial }: { initial: NetworkSnapshot }) {
  const { snapshot, offline } = useLiveSnapshot(initial);
  const reduceMotion = useReducedMotion();
  const [selected, setSelected] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const panel = useId();
  const focus = hovered ?? selected;
  const neighbours = new Set(
    focus ? snapshot.edges.flatMap((e) => (e.from === focus || e.to === focus ? [e.from, e.to] : [])) : [],
  );
  const max = Math.max(0, ...snapshot.edges.map((e) => e.calls));
  const chosen = snapshot.nodes.find((n) => n.id === selected);
  const chosenEdges = chosen ? snapshot.edges.filter((e) => e.from === chosen.id || e.to === chosen.id) : [];
  const name = (id: string) => snapshot.nodes.find((n) => n.id === id)?.name ?? id;

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          aria-hidden
          className={cn('size-1.5 rounded-full', offline ? 'bg-amber-500' : 'bg-emerald-500')}
        />
        {offline
          ? 'Could not refresh. Showing the last answer and trying again.'
          : `Live. Call counts cover the last ${snapshot.windowMinutes} minutes.`}
      </p>
      <div className="overflow-x-auto rounded-2xl border bg-muted/30">
        <div
          role="group"
          aria-label="System map"
          className="relative mx-auto min-w-[760px]"
          style={{ aspectRatio: `${VIEW.w} / ${VIEW.h}` }}
        >
          <svg
            aria-hidden
            viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 size-full"
          >
            {snapshot.edges.map((edge) => (
              <Link
                key={edge.id}
                edge={edge}
                max={max}
                motion={!reduceMotion}
                lit={Boolean(focus) && (edge.from === focus || edge.to === focus)}
                faded={Boolean(focus) && edge.from !== focus && edge.to !== focus}
              />
            ))}
          </svg>
          {snapshot.nodes.map((node) => (
            <Card
              key={node.id}
              node={node}
              panel={panel}
              selected={selected === node.id}
              faded={Boolean(focus) && !neighbours.has(node.id)}
              onSelect={() => setSelected((s) => (s === node.id ? undefined : node.id))}
              onHover={(on) => setHovered((h) => (on ? node.id : h === node.id ? undefined : h))}
            />
          ))}
        </div>
      </div>
      <section id={panel} aria-live="polite" className="min-h-24 rounded-xl border bg-card px-4 py-3 text-sm">
        {chosen ? (
          <>
            <h2 className="font-medium">
              {chosen.name}{' '}
              <span className="font-normal text-muted-foreground">· {STATUS[chosen.status].word}</span>
            </h2>
            <ul className="mt-1.5 flex flex-col gap-0.5 text-muted-foreground">
              {chosen.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {chosenEdges.length > 0 && (
              <ul className="mt-2 flex flex-col gap-0.5 border-t pt-2 text-xs text-muted-foreground">
                {chosenEdges.map((e) => (
                  <li key={e.id}>
                    {name(e.from)} → {name(e.to)}: {e.label}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Select a part to see its details. Escape closes them.</p>
        )}
      </section>
    </div>
  );
}
