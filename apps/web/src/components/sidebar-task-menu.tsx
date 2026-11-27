'use client';
// The ⋯ menu on a sidebar task: rename, copy its key, archive, delete. Hidden until the row is
// hovered or focused on mouse screens; always shown on touch screens.
import { Dialog } from '@base-ui/react/dialog';
import { Menu } from '@base-ui/react/menu';
import { Archive, Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { archiveIssue, deleteIssue, updateIssue } from '@/app/actions';
import { useConfirm } from '@/components/confirm-dialog';
import { Button } from '@factory/ui/components/button';
import { Input } from '@factory/ui/components/input';
import { cn } from '@factory/ui/lib/utils';

const item =
  'flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none select-none data-highlighted:bg-muted';

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
      <Menu.Root>
        <Menu.Trigger
          aria-label={`Options for ${task.key}`}
          className={cn(
            'absolute top-1/2 right-1 z-10 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-foreground/10',
            'pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 pointer-fine:data-popup-open:opacity-100',
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="right" align="start" sideOffset={6} className="z-50">
            <Menu.Popup className="min-w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
              <Menu.Item className={item} onClick={() => (setTitle(task.title), setRenaming(true))}>
                <Pencil className="size-4" aria-hidden /> Rename
              </Menu.Item>
              <Menu.Item
                className={item}
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
              </Menu.Item>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item
                className={item}
                onClick={() => start(async () => done(await archiveIssue(project, task.key, true)))}
              >
                <Archive className="size-4" aria-hidden /> Archive
              </Menu.Item>
              <Menu.Item
                className={cn(item, 'text-destructive')}
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
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Dialog.Root open={renaming} onOpenChange={setRenaming}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 motion-safe:transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-5 shadow-2xl outline-none">
            <Dialog.Title className="text-base font-semibold">Rename {task.key}</Dialog.Title>
            <form
              className="mt-4 flex flex-col gap-4"
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
              <div className="flex justify-end gap-2">
                <Dialog.Close render={<Button type="button" variant="outline" />}>Cancel</Dialog.Close>
                <Button type="submit" disabled={pending || !title.trim()}>
                  {pending ? 'Saving…' : 'Rename'}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
