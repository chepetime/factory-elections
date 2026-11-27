'use client';
// The ⋯ menu on a sidebar task: rename, copy its key, archive, delete. Hidden until the row is
// hovered or focused on mouse screens; always shown on touch screens.
import { Archive, Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { archiveIssue, deleteIssue, updateIssue } from '@/app/actions';
import { useConfirm } from '@/components/confirm-dialog';
import { Button } from '@factory/ui/components/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from '@factory/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@factory/ui/components/dropdown-menu';
import { Input } from '@factory/ui/components/input';
import { cn } from '@factory/ui/lib/utils';

export function SidebarTaskMenu({
  project,
  task,
  onChanged,
  onNotice,
}: {
  project: string;
  task: { key: string; title: string };
  onChanged: () => void;
  onNotice: (text: string, tone?: 'error' | 'status') => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [pending, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const done = (result: { error?: string; message?: string }, fallback = '') => {
    if (result.error) onNotice(result.error, 'error');
    else if (result.message || fallback) onNotice(result.message || fallback);
    onChanged();
    router.refresh();
  };

  return (
    <>
      {dialog}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${task.key}`}
          className={cn(
            'absolute top-1/2 right-1 z-10 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-foreground/10',
            'pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 pointer-fine:data-popup-open:opacity-100',
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="min-w-44">
          <DropdownMenuItem onClick={() => (setTitle(task.title), setRenaming(true))}>
            <Pencil className="size-4" aria-hidden /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(task.key);
                onNotice(`Copied ${task.key}.`);
              } catch {
                onNotice('Could not copy. Your browser blocked the clipboard.', 'error');
              }
            }}
          >
            <Copy className="size-4" aria-hidden /> Copy ID
            <span className="ml-auto font-mono text-xs text-muted-foreground">{task.key}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => start(async () => done(await archiveIssue(project, task.key, true)))}
          >
            <Archive className="size-4" aria-hidden /> Archive
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
              const yes = await confirm({
                title: `Delete ${task.key}?`,
                body: `"${task.title}" and its runs, worktrees and branches are removed. This cannot be undone.`,
                confirm: 'Delete',
                tone: 'destructive',
              });
              if (!yes) return;
              start(async () => {
                // The backend deletes archived tasks only, so a task in work cannot vanish.
                const archived = await archiveIssue(project, task.key, true);
                if (archived.error) return done(archived);
                done(await deleteIssue(project, task.key));
              });
            }}
          >
            <Trash2 className="size-4" aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent showCloseButton={false} className="w-[min(26rem,calc(100vw-2rem))]">
          <DialogTitle>Rename {task.key}</DialogTitle>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const next = title.trim();
              if (!next || next === task.title) return setRenaming(false);
              start(async () => {
                const result = await updateIssue(project, task.key, { title: next });
                if (!result.error) setRenaming(false);
                done(result.error ? result : {}, '');
              });
            }}
          >
            <label htmlFor={`rename-${task.key}`} className="sr-only">
              Title
            </label>
            <Input
              id={`rename-${task.key}`}
              value={title}
              maxLength={200}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
            />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={pending || !title.trim()}>
                {pending ? 'Saving…' : 'Rename'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
