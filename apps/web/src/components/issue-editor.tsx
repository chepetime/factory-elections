'use client';
// Editable parts of a board task's page: title, description, priority, status and comments.
import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import type { IssuePriority, IssueStatus, Stage } from '@factory/core';
import { commentIssue, moveIssue, updateIssue, type ActionState } from '@/app/actions';
import { Markdown } from '@/components/markdown';
import { useConfirm } from '@/components/confirm-dialog';
import { decideDrop, MoveMenu } from '@/components/task-board';
import { StatusLabel } from '@/components/task-status';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

function useSave(project: string, key: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const save = (patch: { title?: string; description?: string; priority?: string }, done?: () => void) =>
    start(async () => {
      const result = await updateIssue(project, key, patch);
      setError(result.error);
      if (!result.error) {
        done?.();
        router.refresh();
      }
    });
  return { pending, error, save };
}

export function IssueTitle({
  project,
  issueKey,
  title,
}: {
  project: string;
  issueKey: string;
  title: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const { pending, error, save } = useSave(project, issueKey);
  const commit = () => {
    if (!value.trim() || value.trim() === title) {
      setValue(title);
      setEditing(false);
      return;
    }
    save({ title: value.trim() }, () => setEditing(false));
  };
  if (!editing)
    return (
      <div className="group flex items-start gap-2">
        <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight text-pretty">{title}</h1>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit the title"
          className="mt-1 text-muted-foreground pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden />
        </Button>
      </div>
    );
  return (
    <div>
      <label htmlFor="issue-title" className="sr-only">
        Title
      </label>
      <input
        id="issue-title"
        autoFocus
        value={value}
        maxLength={200}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setValue(title);
            setEditing(false);
          }
        }}
        className="w-full rounded-lg border bg-background px-2 py-1 text-2xl font-semibold tracking-tight outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function IssueDescription({
  project,
  issueKey,
  description,
}: {
  project: string;
  issueKey: string;
  description: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description);
  const { pending, error, save } = useSave(project, issueKey);
  if (!editing)
    return (
      <div className="group relative">
        {description.trim() ? (
          <div className="text-sm leading-relaxed">
            <Markdown text={description} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No description yet.</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 -ml-2 text-muted-foreground"
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden /> {description.trim() ? 'Edit description' : 'Add a description'}
        </Button>
      </div>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({ description: value }, () => setEditing(false));
      }}
    >
      <label htmlFor="issue-description" className="sr-only">
        Description (Markdown)
      </label>
      <Textarea
        id="issue-description"
        autoFocus
        rows={8}
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue(description);
            setEditing(false);
          }
        }}
        className="text-sm"
      />
      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setValue(description);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

const PRIORITIES: { value: IssuePriority; label: string }[] = [
  { value: 'none', label: 'No priority' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export function IssuePriorityField({
  project,
  issueKey,
  priority,
  id,
}: {
  project: string;
  issueKey: string;
  priority: IssuePriority;
  id: string;
}) {
  const { pending, error, save } = useSave(project, issueKey);
  return (
    <>
      <select
        id={id}
        defaultValue={priority}
        disabled={pending}
        onChange={(e) => save({ priority: e.target.value })}
        className="-mx-1.5 h-7 w-full cursor-pointer rounded-md border-0 bg-transparent px-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {PRIORITIES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

export function IssueStatusField({
  project,
  issue,
}: {
  project: string;
  issue: { key: string; title: string; status: IssueStatus; run?: { id: string; stage: Stage } };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ kind: 'error' | 'status'; text: string }>();
  const [confirm, confirmDialog] = useConfirm();
  const move = async (to: IssueStatus) => {
    const action = await decideDrop(issue, to, confirm);
    if (!action || action.kind === 'none') return;
    if (action.kind === 'refused') return setNotice({ kind: 'error', text: action.reason });
    start(async () => {
      const result = await moveIssue(project, issue.key, to);
      setNotice(
        result.error ? { kind: 'error', text: result.error } : { kind: 'status', text: result.message ?? '' },
      );
      router.refresh();
    });
  };
  return (
    <div>
      {confirmDialog}
      <div className={cn('group flex items-center gap-1', pending && 'opacity-60')}>
        <StatusLabel status={issue.status} className="text-sm" />
        <MoveMenu issue={{ ...issue, description: '', updated_at: '' }} onMove={move} />
      </div>
      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'mt-1 text-xs',
            notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}

export function IssueCommentBox({ project, issueKey }: { project: string; issueKey: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(commentIssue, {});
  const [text, setText] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  useEffect(() => {
    if (state.message) setText('');
  }, [state]);
  return (
    <div className="shrink-0 px-6 pb-5">
      <form ref={form} action={action} className="mx-auto max-w-3xl">
        <input type="hidden" name="project" value={project} />
        <input type="hidden" name="key" value={issueKey} />
        <div className="rounded-2xl border bg-background shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
          <label htmlFor={id} className="sr-only">
            Comment
          </label>
          <Textarea
            id={id}
            name="body"
            rows={2}
            value={text}
            placeholder="Leave a comment…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim() && !pending) {
                e.preventDefault();
                form.current?.requestSubmit();
              }
            }}
            className="max-h-60 min-h-14 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center gap-2 px-3 pb-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">⌘↵ to send</span>
            {(state.error || state.message) && (
              <p
                role={state.error ? 'alert' : 'status'}
                className={cn('text-xs', state.error ? 'text-destructive' : 'text-muted-foreground')}
              >
                {state.error ?? state.message}
              </p>
            )}
            <Button type="submit" size="sm" className="ml-auto" disabled={!text.trim() || pending}>
              {pending ? 'Sending…' : 'Comment'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
