'use client';
// A run's whole session, like a terminal transcript: the agent's messages, each tool call with its
// input, and the result under it. Polls while the run works and follows the bottom.
import { ChevronRight, CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { LocalTime } from '@/components/local-time';
import { Markdown } from '@/components/markdown';
import { cn } from '@/lib/utils';

type Entry =
  | { at: string; kind: 'run'; text: string }
  | { at: string; kind: 'text'; text: string; step?: string; sub?: boolean }
  | { at: string; kind: 'tool'; tool: string; input: string; call?: string; step?: string; sub?: boolean }
  | { at: string; kind: 'result'; ok: boolean; text: string; call?: string; sub?: boolean };
type Session = { entries: Entry[]; live: boolean };

const POLL_MS = 1500;

/** `mcp__factory__comment` reads "Factory · comment"; built-in tools keep their names. */
function toolName(name: string): string {
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  if (!mcp) return name;
  const server = mcp[1] === 'factory' ? 'Factory' : mcp[1]!;
  return `${server} · ${mcp[2]!.replace(/_/g, ' ')}`;
}

/** A tool call with its result, which the log stores as two entries joined by the call id. */
function ToolCall({
  tool,
  result,
  live,
}: {
  tool: Extract<Entry, { kind: 'tool' }>;
  result?: Extract<Entry, { kind: 'result' }>;
  live: boolean;
}) {
  const running = !result && live;
  return (
    <li className={cn('text-xs', tool.sub && 'ml-4 border-l pl-3')}>
      <details className="group/tool">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 select-none hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground transition-transform group-open/tool:rotate-90 motion-reduce:transition-none"
          />
          {running ? (
            <LoaderCircle
              className="size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin"
              aria-label="Running"
            />
          ) : result?.ok === false ? (
            <CircleX className="size-3.5 shrink-0 text-destructive" aria-label="Failed" />
          ) : (
            <CircleCheck
              className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-label="Done"
            />
          )}
          <span className="shrink-0 font-medium">{toolName(tool.tool)}</span>
          <span className="min-w-0 truncate font-mono text-muted-foreground" title={tool.input}>
            {tool.input}
          </span>
        </summary>
        <div className="mt-1 mb-2 ml-5 flex flex-col gap-1.5">
          {tool.input && (
            <pre className="overflow-x-auto rounded-md bg-muted/60 px-2.5 py-1.5 font-mono whitespace-pre-wrap">
              {tool.input}
            </pre>
          )}
          {result ? (
            <pre
              className={cn(
                'max-h-72 overflow-auto rounded-md border px-2.5 py-1.5 font-mono whitespace-pre-wrap',
                !result.ok && 'border-destructive/40 text-destructive',
              )}
            >
              {result.text || 'No output.'}
            </pre>
          ) : (
            <p className="text-muted-foreground">{live ? 'Running…' : 'No result was recorded.'}</p>
          )}
        </div>
      </details>
    </li>
  );
}

export function RunSessionView({
  project,
  runId,
  initial,
  author,
}: {
  project: string;
  runId: string;
  initial: Session;
  author: { name: string; avatar: string };
}) {
  const router = useRouter();
  const [session, setSession] = useState(initial);
  const end = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => setSession(initial), [initial]);
  useEffect(() => {
    if (!session.live) return;
    let alive = true;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/projects/${project}/tasks/${runId}/session`, { cache: 'no-store' }).catch(
        () => undefined,
      );
      if (!alive || !res?.ok) return;
      const next = (await res.json()) as Session;
      setSession(next);
      // The run ended: reload the page so stage, actions and the reply box catch up.
      if (!next.live) router.refresh();
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project, runId, session.live, router]);
  // Follow the newest entry while it is in view; scrolling up to read stops that. The session sits
  // above the run's status and actions, so "in view" means its end, not the box's bottom.
  const below = (box: HTMLElement) =>
    end.current!.getBoundingClientRect().top - box.getBoundingClientRect().bottom;
  useEffect(() => {
    const box = end.current?.closest<HTMLElement>('[data-run-scroll]');
    if (!box) return;
    const onScroll = () => {
      pinned.current = below(box) < 160;
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => box.removeEventListener('scroll', onScroll);
  }, []);
  const last = session.entries.at(-1);
  useLayoutEffect(() => {
    const box = end.current?.closest<HTMLElement>('[data-run-scroll]');
    if (!box || !pinned.current) return;
    const gap = below(box) + 32;
    if (gap > 0) box.scrollTop += gap;
  }, [session.entries.length, last?.at, session.live]);

  const results = new Map(
    session.entries.flatMap((e) => (e.kind === 'result' && e.call ? [[e.call, e] as const] : [])),
  );
  const blocks: React.ReactNode[] = [];
  let tools: React.ReactNode[] = [];
  const flush = (key: string) => {
    if (tools.length)
      blocks.push(
        <ul key={key} className="flex flex-col">
          {tools}
        </ul>,
      );
    tools = [];
  };
  session.entries.forEach((e, i) => {
    if (e.kind === 'tool') {
      tools.push(
        <ToolCall
          key={i}
          tool={e}
          {...(e.call && results.get(e.call) ? { result: results.get(e.call)! } : {})}
          live={session.live}
        />,
      );
      return;
    }
    if (e.kind === 'result') return;
    flush(`t${i}`);
    if (e.kind === 'run')
      blocks.push(
        <div key={i} className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" aria-hidden />
          <span className="max-w-[80%] truncate" title={e.text}>
            {e.text}
          </span>
          <LocalTime iso={e.at} className="shrink-0" />
          <span className="h-px flex-1 bg-border" aria-hidden />
        </div>,
      );
    else
      blocks.push(
        <div key={i} className={cn('flex gap-2.5', e.sub && 'ml-4 border-l pl-3')}>
          <AgentAvatar agent={author} size="sm" decorative className="mt-0.5" />
          <div className="min-w-0 flex-1 text-sm leading-relaxed">
            <Markdown text={e.text} />
          </div>
        </div>,
      );
  });
  flush('end');

  return (
    <div className="flex flex-col gap-3" aria-live="off">
      {blocks.length ? (
        blocks
      ) : (
        <p className="text-sm text-muted-foreground">
          {session.live ? `${author.name} is starting…` : 'No session recorded for this run yet.'}
        </p>
      )}
      {session.live && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden /> {author.name} is working
        </p>
      )}
      <div ref={end} />
    </div>
  );
}
