'use client';
// Editable parts of a board task's page: title, description, priority, status and comments.
import { ArchiveRestore, ArrowUp, LoaderCircle, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import type { IssuePriority, IssueStatus, Stage } from '@factory/core';
import { archiveIssue, commentIssue, moveIssue, updateIssue, type ActionState } from '@/app/actions';
import { Markdown } from '@/components/markdown';
import { useConfirm } from '@/components/confirm-dialog';
import { decideDrop, followUpHref, MoveMenu } from '@/components/task-board';
import { StatusLabel } from '@/components/task-status';
import { Button } from '@factory/ui/components/button';
import { Textarea } from '@factory/ui/components/textarea';
import { MentionTextarea, type MentionAgent } from '@/components/mention-textarea';
import { cn } from '@factory/ui/lib/utils';

export function useSave(project: string, key: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const save = (
    patch: {
      title?: string;
      description?: string;
      priority?: string;
      start_date?: string | null;
      due_date?: string | null;
      blocked_by?: string[];
    },
    done?: () => void,
  ) =>
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
          // Start from the title on the page now, not the one from the first render.
          onClick={() => {
            setValue(title);
            setEditing(true);
          }}
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
          // A fixed height with its own scroll: a long description must not push the activity away.
          // Focusable, so the region scrolls from the keyboard too.
          <div
            role="region"
            aria-label="Description"
            tabIndex={0}
            className="max-h-80 overflow-y-auto overscroll-contain rounded-lg border bg-muted/20 px-4 py-3 text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Markdown text={description} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No description yet.</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 -ml-2 text-muted-foreground"
          onClick={() => {
            setValue(description);
            setEditing(true);
          }}
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
        className="h-80 max-h-80 field-sizing-fixed text-sm"
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
  className,
}: {
  project: string;
  issueKey: string;
  priority: IssuePriority;
  id: string;
  className?: string;
}) {
  const { pending, error, save } = useSave(project, issueKey);
  return (
    <>
      <select
        id={id}
        defaultValue={priority}
        disabled={pending}
        onChange={(e) => save({ priority: e.target.value })}
        className={cn(
          '-mx-1.5 h-7 w-full cursor-pointer rounded-md border-0 bg-transparent px-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
          className,
        )}
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

/** A planning date (start or due). Clearing the input removes the date. */
export function IssueDateField({
  project,
  issueKey,
  field,
  value,
  id,
  overdue,
}: {
  project: string;
  issueKey: string;
  field: 'start_date' | 'due_date';
  value?: string;
  id: string;
  /** Shows the date as late: a due date in the past on an open task. */
  overdue?: boolean;
}) {
  const { pending, error, save } = useSave(project, issueKey);
  return (
    <>
      <input
        id={id}
        type="date"
        defaultValue={value ?? ''}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value || null;
          if (next !== (value ?? null)) save({ [field]: next });
        }}
        className={cn(
          'h-7 cursor-pointer rounded-md border-0 bg-transparent px-1.5 text-sm tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
          !value && 'text-muted-foreground',
          overdue && 'text-destructive',
        )}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

/** Tickets this one waits for, as comma-separated keys. Saved when the field loses focus. */
export function IssueBlockedByField({
  project,
  issueKey,
  blockedBy,
}: {
  project: string;
  issueKey: string;
  blockedBy: string[];
}) {
  const { pending, error, save } = useSave(project, issueKey);
  const current = blockedBy.join(', ');
  return (
    <>
      <input
        aria-label="Blocked by"
        defaultValue={current}
        placeholder="None"
        disabled={pending}
        onBlur={(e) => {
          const keys = e.target.value
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean);
          if (keys.join(', ') !== current) save({ blocked_by: keys });
        }}
        className="-mx-1.5 h-7 w-full rounded-md border-0 bg-transparent px-1.5 font-mono text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

/** The agent that works this task. Moving the task to In progress starts it. */
export function IssueAssigneeField({
  project,
  issueKey,
  assignee,
  agents,
  id,
  className,
}: {
  project: string;
  issueKey: string;
  assignee?: string;
  agents: { id: string; name: string; avatar: string; archived: boolean }[];
  id: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <>
      <select
        id={id}
        value={assignee ?? ''}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const result = await updateIssue(project, issueKey, { assignee: e.target.value || null });
            setError(result.error);
            router.refresh();
          })
        }
        className={cn(
          '-mx-1.5 h-7 w-full cursor-pointer rounded-md border-0 bg-transparent px-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
          className,
        )}
      >
        <option value="">No agent</option>
        {agents
          .filter((a) => !a.archived || a.id === assignee)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.avatar} {a.name}
              {a.archived ? ' (archived)' : ''}
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
    if (action.kind === 'follow-up') return router.push(followUpHref(project, issue.key));
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
        <MoveMenu
          issue={{ ...issue, description: '', updated_at: '' }}
          onMove={move}
          onArchive={() =>
            start(async () => {
              const result = await archiveIssue(project, issue.key, true);
              setNotice(
                result.error
                  ? { kind: 'error', text: result.error }
                  : { kind: 'status', text: result.message ?? '' },
              );
              router.refresh();
            })
          }
        />
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

export function IssueCommentBox({
  project,
  issueKey,
  placeholder = 'Leave a comment… Type @ to mention an agent.',
  agents = [],
}: {
  project: string;
  issueKey: string;
  placeholder?: string;
  /** Agents the comment can @mention. */
  agents?: readonly MentionAgent[];
}) {
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
          <MentionTextarea
            id={id}
            name="body"
            rows={2}
            value={text}
            placeholder={placeholder}
            agents={agents}
            onValueChange={setText}
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

/** The reply line at the foot of a comment thread. Enter sends; Shift+Enter starts a new line. */
export function IssueReplyBox({
  project,
  issueKey,
  parent,
  agents = [],
}: {
  project: string;
  issueKey: string;
  parent: string;
  agents?: readonly MentionAgent[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(commentIssue, {});
  const [text, setText] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  useEffect(() => {
    if (state.message) setText('');
  }, [state]);
  return (
    <form ref={form} action={action} className="border-t bg-muted/30 px-4 py-2">
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="key" value={issueKey} />
      <input type="hidden" name="parent" value={parent} />
      <div className="flex items-end gap-2">
        <label htmlFor={id} className="sr-only">
          Reply
        </label>
        <MentionTextarea
          id={id}
          name="body"
          rows={1}
          value={text}
          placeholder="Leave a reply…"
          agents={agents}
          onValueChange={setText}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (text.trim() && !pending) form.current?.requestSubmit();
            }
          }}
          className="field-sizing-content max-h-40 min-h-8 resize-none border-0 bg-transparent px-0 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Button
          type="submit"
          size="icon-sm"
          aria-label="Send the reply"
          disabled={!text.trim() || pending}
          className="mb-0.5 shrink-0 rounded-full"
        >
          {pending ? (
            <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
          ) : (
            <ArrowUp aria-hidden />
          )}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="pb-1 text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function IssueArchivedBanner({ project, issueKey }: { project: string; issueKey: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b bg-muted/50 px-6 py-2.5 text-sm">
      <p className="min-w-0 flex-1 text-muted-foreground">
        This task is archived. It is not on the board or in the sidebar.
        {error && <span className="ml-2 text-destructive">{error}</span>}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await archiveIssue(project, issueKey, false);
            setError(result.error);
            router.refresh();
          })
        }
      >
        <ArchiveRestore aria-hidden /> {pending ? 'Restoring…' : 'Restore'}
      </Button>
    </div>
  );
}
