// The ticket's activity feed: events folded into runs of happenings, and comment threads.
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { type IssueStatus } from '@factory/core';
import { LocalTime } from '@/components/local-time';
import { Markdown } from '@/components/markdown';
import { IssueReplyBox } from '@/components/issue-editor';
import { STATUS } from '@/components/task-status';
import { type IssueView } from '@/lib/issues';
import { AgentAvatar } from '@/components/agent-avatar';
import { cn } from '@/lib/utils';

export type IssueEvent = IssueView['events'][number];
type IssueComment = IssueView['comments'][number];
export type FeedItem =
  | { at: string; kind: 'event'; event: IssueEvent }
  | { at: string; kind: 'thread'; root: IssueComment; replies: IssueComment[] };

/** Status changes show the new status icon; older events only carry it in their kind. */
function eventStatus(event: IssueEvent): IssueStatus | undefined {
  const to = event.to ?? (event.kind.startsWith('move:') ? event.kind.slice(5) : undefined);
  return to && to in STATUS ? (to as IssueStatus) : undefined;
}

function Happening({ event }: { event: IssueEvent }) {
  const status = eventStatus(event);
  const look = status ? STATUS[status] : undefined;
  return (
    <li className="flex items-center gap-2.5 py-1.5 text-sm text-muted-foreground">
      {look ? (
        <look.icon className={cn('size-4 shrink-0', look.tone)} aria-hidden />
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
          <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        </span>
      )}
      <span className="min-w-0 flex-1">{event.message}</span>
      <LocalTime iso={event.at} format="date-time" className="shrink-0 text-xs tabular-nums" />
    </li>
  );
}

/** Two or more events in a row fold under one "N activities" line. */
function Happenings({ events }: { events: IssueEvent[] }) {
  const rows = events.map((e, i) => <Happening key={`${e.at}-${e.kind}-${i}`} event={e} />);
  if (events.length === 1) return <ol>{rows}</ol>;
  return (
    <details open className="group/acts">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-md py-1 text-sm text-muted-foreground select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform duration-150 ease-out group-open/acts:rotate-90 motion-reduce:transition-none"
        />
        {events.length} activities
      </summary>
      <ol>{rows}</ol>
    </details>
  );
}

export type Authors = Record<string, { name: string; avatar: string }>;

function CommentBody({
  comment,
  reply,
  authors,
}: {
  comment: IssueComment;
  reply?: boolean;
  authors: Authors;
}) {
  const agent =
    comment.author === 'you'
      ? undefined
      : (authors[comment.author] ?? { name: comment.author, avatar: '🤖' });
  return (
    <div className={cn('px-4 py-3', reply && 'border-t')}>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {agent && <AgentAvatar agent={agent} size="sm" decorative />}
        <span className="text-sm font-medium text-foreground">{agent?.name ?? 'You'}</span>
        <LocalTime iso={comment.at} format="date-time" />
      </p>
      <div className="mt-1.5 text-sm">
        <Markdown
          text={comment.body}
          mentions={Object.fromEntries(
            (comment.mentions ?? []).flatMap((id) => (authors[id] ? [[id, authors[id]]] : [])),
          )}
        />
      </div>
    </div>
  );
}

function Thread({
  project,
  issueKey,
  root,
  replies,
  authors,
}: {
  project: string;
  issueKey: string;
  root: IssueComment;
  replies: IssueComment[];
  authors: Authors;
}) {
  return (
    <article
      aria-label={`Comment thread, ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
      className="overflow-hidden rounded-xl border bg-card shadow-xs"
    >
      <CommentBody comment={root} authors={authors} />
      {replies.map((r) => (
        <CommentBody key={r.id} comment={r} reply authors={authors} />
      ))}
      <IssueReplyBox
        project={project}
        issueKey={issueKey}
        parent={root.id}
        agents={Object.entries(authors).map(([id, a]) => ({ id, name: a.name, avatar: a.avatar }))}
      />
    </article>
  );
}

export function feedItems(issue: IssueView): FeedItem[] {
  const roots = issue.comments.filter((c) => !c.parent || !issue.comments.some((r) => r.id === c.parent));
  return [
    ...issue.events.map((event): FeedItem => ({ at: event.at, kind: 'event', event })),
    ...roots.map((root): FeedItem => ({
      at: root.at,
      kind: 'thread',
      root,
      replies: issue.comments.filter((c) => c.parent === root.id),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

export function Feed({
  items,
  project,
  issueKey,
  authors,
}: {
  items: FeedItem[];
  project: string;
  issueKey: string;
  authors: Authors;
}) {
  const blocks: ReactNode[] = [];
  let events: IssueEvent[] = [];
  const flush = () => {
    if (events.length) blocks.push(<Happenings key={`acts-${blocks.length}`} events={events} />);
    events = [];
  };
  for (const item of items) {
    if (item.kind === 'event') {
      events.push(item.event);
      continue;
    }
    flush();
    blocks.push(
      <Thread
        key={item.root.id}
        project={project}
        issueKey={issueKey}
        root={item.root}
        replies={item.replies}
        authors={authors}
      />,
    );
  }
  flush();
  return blocks.length ? <div className="mt-3 flex flex-col gap-3">{blocks}</div> : null;
}

/** `https://github.com/o/r/pull/12` reads `o/r#12`; any other URL stays as it is. */
