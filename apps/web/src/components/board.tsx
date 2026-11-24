// The board: four columns of task cards (docs/vision/ui.md). Plain props, no data loading, so it
// renders on the server and in Storybook alike. Each card's title is a link to the task page that
// covers the whole card; the one primary action sits above that link as its own control.
import { ArrowUpRight, FolderGit2, GitBranch, GitPullRequest, Plus } from 'lucide-react';
import Link from 'next/link';
import {
  COLUMNS,
  COLUMN_LABEL,
  age,
  type Board as BoardData,
  type BoardCard,
  type Column,
  type LiveTone,
} from '@/lib/board';
import { cn } from '@/lib/utils';

const DOT: Record<Column, string> = {
  working: 'bg-blue-500',
  'needs-me': 'bg-orange-500',
  'in-review': 'bg-yellow-500',
  ready: 'bg-emerald-500',
};

const TONE: Record<LiveTone, string> = {
  working: 'text-blue-700 dark:text-blue-400',
  'needs-me': 'text-orange-700 dark:text-orange-400',
  'in-review': 'text-yellow-800 dark:text-yellow-400',
  ready: 'text-emerald-700 dark:text-emerald-400',
  danger: 'text-destructive',
  muted: 'text-muted-foreground',
};

function Card({ card, now, showProject }: { card: BoardCard; now: number; showProject: boolean }) {
  const when = age(card.live.at, now);
  const ResourceIcon = card.resource.kind === 'branch' ? GitBranch : FolderGit2;
  return (
    <article className="relative flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-card-foreground shadow-xs transition-colors hover:bg-accent/50">
      <h3 className="line-clamp-2 text-sm leading-5 font-medium" title={card.title}>
        <Link
          href={card.href}
          className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
        >
          {card.title}
        </Link>
      </h3>
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <ResourceIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">{card.resource.kind === 'branch' ? 'Branch' : 'Repository'}: </span>
        {showProject && <span className="shrink-0 font-medium text-foreground/80">{card.project}</span>}
        {!(showProject && card.resource.kind === 'repo' && card.resource.text === card.project) && (
          <span className="min-w-0 truncate font-mono">{card.resource.text}</span>
        )}
      </p>
      {card.pr && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <GitPullRequest className="size-3.5 shrink-0" aria-hidden />
          <span className="tabular-nums">#{card.pr.number}</span>
          {card.pr.author && <span className="truncate">by {card.pr.author}</span>}
        </p>
      )}
      <div className="mt-0.5 flex min-h-7 items-center gap-2">
        <p className={cn('flex min-w-0 flex-1 items-baseline gap-1.5 text-xs', TONE[card.live.tone])}>
          <span className="min-w-0 truncate" title={card.live.text}>
            {card.live.text}
          </span>
          {when && (
            <time dateTime={card.live.at} className="shrink-0 text-muted-foreground tabular-nums">
              {when}
            </time>
          )}
        </p>
        {card.action &&
          (card.action.external ? (
            <a
              href={card.action.href}
              target="_blank"
              rel="noreferrer"
              className="relative z-10 inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-foreground px-2.5 text-xs font-medium text-background hover:bg-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
            >
              {card.action.label}
              <ArrowUpRight className="size-3.5" aria-hidden />
              <span className="sr-only"> (opens GitHub)</span>
            </a>
          ) : (
            <Link
              href={card.action.href}
              className="relative z-10 inline-flex h-7 shrink-0 items-center rounded-md bg-foreground px-2.5 text-xs font-medium text-background hover:bg-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
            >
              {card.action.label}
            </Link>
          ))}
      </div>
    </article>
  );
}

function BoardColumn({
  column,
  cards,
  now,
  showProject,
}: {
  column: Column;
  cards: BoardCard[];
  now: number;
  showProject: boolean;
}) {
  const id = `board-${column}`;
  return (
    <section
      aria-labelledby={id}
      className="flex w-72 min-w-72 flex-1 flex-col rounded-xl bg-muted/50 dark:bg-muted/30"
    >
      <h2 id={id} className="flex items-center gap-2 px-3 pt-3 pb-2 text-sm font-medium">
        <span className={cn('size-2 rounded-full', DOT[column])} aria-hidden />
        {COLUMN_LABEL[column]}
        <span className="text-muted-foreground tabular-nums">
          <span className="sr-only">, </span>
          {cards.length}
          <span className="sr-only"> {cards.length === 1 ? 'task' : 'tasks'}</span>
        </span>
      </h2>
      {cards.length === 0 ? (
        <p className="mx-2 mb-2 rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          No tasks
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {cards.map((card) => (
            <li key={card.id}>
              <Card card={card} now={now} showProject={showProject} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Board({
  board,
  now,
  newTaskHref,
  showProject = false,
  notice,
}: {
  board: BoardData;
  /** Epoch milliseconds the ages count from. */
  now: number;
  /** Where "New task" goes; no button without it. */
  newTaskHref?: string;
  /** Show each card's project, for a board across several projects. */
  showProject?: boolean;
  /** A short note about data the board could not load. */
  notice?: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        <h1 className="text-sm font-semibold">Board</h1>
        {notice && <p className="min-w-0 truncate text-xs text-muted-foreground">{notice}</p>}
        {newTaskHref && (
          <Link
            href={newTaskHref}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background shadow-xs hover:bg-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
          >
            <Plus className="size-4" aria-hidden /> New task
          </Link>
        )}
      </header>
      {/* Focusable so keyboard users can scroll the columns sideways on a narrow screen. */}
      <div
        role="region"
        aria-label="Board columns"
        tabIndex={0}
        className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {COLUMNS.map((column) => (
          <BoardColumn
            key={column}
            column={column}
            cards={board.columns[column]}
            now={now}
            showProject={showProject}
          />
        ))}
      </div>
      <p className="border-t px-4 py-2 text-xs text-muted-foreground tabular-nums">
        Archived {board.archived}
      </p>
    </div>
  );
}
