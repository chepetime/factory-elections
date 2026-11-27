// The ticket's pull request, under its description: the link and where it stands. It stays after
// the PR merges, so a done ticket keeps the way to its change.
import { GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react';
import { prLabel } from '@/components/task-runs';
import { cn } from '@factory/ui/lib/utils';

const LOOK = {
  OPEN: { icon: GitPullRequest, label: 'Open', tone: 'text-emerald-700 dark:text-emerald-400' },
  MERGED: { icon: GitMerge, label: 'Merged', tone: 'text-violet-700 dark:text-violet-400' },
  CLOSED: { icon: GitPullRequestClosed, label: 'Closed', tone: 'text-muted-foreground' },
} as const;

export function TaskPrLink({
  url,
  state,
  title,
}: {
  url: string;
  state: keyof typeof LOOK;
  /** For a review ticket: the PR's own title. */
  title?: string;
}) {
  const look = LOOK[state];
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <look.icon aria-hidden className={cn('size-4 shrink-0', look.tone)} />
      <span className="text-muted-foreground">Pull request</span>
      <a href={url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
        {prLabel(url)}
      </a>
      {title && <span className="min-w-0 truncate text-muted-foreground">{title}</span>}
      <span className={cn('ml-auto text-xs font-medium', look.tone)}>{look.label}</span>
    </p>
  );
}
