// The task panel's Changes tab: what the run changed against its base branch, file by file.
// Each file folds open to its own diff; the list on top shows the size of each change.
import { ChevronRight } from 'lucide-react';
import { DiffCodeBlock } from '@/components/diff-code-block';
import { diffFiles, type DiffFile } from '@/lib/diff-files';
import { cn } from '@factory/ui/lib/utils';

const STATUS: Record<DiffFile['status'], { label: string; tone: string }> = {
  added: { label: 'Added', tone: 'text-emerald-700 dark:text-emerald-400' },
  deleted: { label: 'Deleted', tone: 'text-destructive' },
  renamed: { label: 'Renamed', tone: 'text-amber-700 dark:text-amber-400' },
  modified: { label: 'Modified', tone: 'text-muted-foreground' },
  binary: { label: 'Binary', tone: 'text-muted-foreground' },
};
/** Files this size or smaller start open. */
const OPEN_LINES = 80;

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      <span className="text-emerald-700 dark:text-emerald-400">+{added}</span>{' '}
      <span className="text-destructive">−{removed}</span>
    </span>
  );
}

export function TaskChanges({ diff, base }: { diff: string; base?: string }) {
  const files = diffFiles(diff);
  if (!files.length)
    return (
      <p className="px-5 py-6 text-sm text-muted-foreground">
        This run has no changes against its base branch.
      </p>
    );
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <p className="flex items-center justify-between gap-3 text-sm">
        <span>
          {files.length} {files.length === 1 ? 'file' : 'files'} changed
          {base ? <span className="text-muted-foreground"> against {base}</span> : null}
        </span>
        <Counts added={added} removed={removed} />
      </p>
      <ul className="flex flex-col gap-2" aria-label="Changed files">
        {files.map((f) => {
          const look = STATUS[f.status];
          return (
            <li key={`${f.from ?? ''}>${f.path}`}>
              <details
                open={f.added + f.removed <= OPEN_LINES}
                className="group/file rounded-lg border bg-card"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm select-none [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/file:rotate-90 motion-reduce:transition-none"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>
                    {f.from ? `${f.from} → ${f.path}` : f.path}
                  </span>
                  <span className={cn('shrink-0 text-xs', look.tone)}>{look.label}</span>
                  <Counts added={f.added} removed={f.removed} />
                </summary>
                <div className="border-t">
                  <DiffCodeBlock code={f.text} filename={f.path} showLineNumbers maxHeight="28rem" />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
