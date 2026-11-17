'use client';
// Chat column for a task: the conversation scrolls, the composer stays pinned at the bottom.
// The composer either starts a new task (with a preset type) or sends a revision note.
import {
  ArrowUp,
  FileText,
  GitPullRequest,
  Hammer,
  LoaderCircle,
  MessageSquare,
  Play,
  type LucideIcon,
} from 'lucide-react';
import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { reviseTask, submitTask, type ActionState } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type TaskType = 'ticket' | 'work' | 'review' | 'general';

const PRESETS: Record<TaskType, { label: string; icon: LucideIcon; placeholder: string; preamble?: string }> =
  {
    ticket: {
      label: 'Create ticket',
      icon: FileText,
      placeholder: 'What should the ticket cover? The problem, who it affects, what done looks like…',
      preamble:
        'Create a ticket for this repository. Investigate the code first, then write a GitHub issue with a clear title, context, acceptance criteria, and the files likely involved. Do not change code.',
    },
    work: {
      label: 'Work on task',
      icon: Hammer,
      placeholder: 'Paste the ticket or issue link, or describe the change…',
      preamble: 'Implement the following task. Keep the change focused and add tests.',
    },
    review: {
      label: 'PR review',
      icon: GitPullRequest,
      placeholder: 'Which pull request (#45 or URL), and anything to focus on…',
      preamble:
        'Review the pull request below. Check correctness, tests, and risk, and report findings by severity with file and line references. Do not push changes.',
    },
    general: {
      label: 'General',
      icon: MessageSquare,
      placeholder: 'Describe one change for this repository…',
    },
  };
const ORDER: TaskType[] = ['ticket', 'work', 'review', 'general'];

/** Scrollable message column that follows new messages unless you scrolled up. */
export function ChatScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });
  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">{children}</div>
    </div>
  );
}

type ComposerProps =
  | { mode: 'new'; project: string }
  | { mode: 'revise'; project: string; id: string }
  | { mode: 'locked'; reason: string };

export function TaskChatComposer(props: ComposerProps) {
  return (
    <div className="shrink-0 px-6 pb-5">
      <div className="mx-auto max-w-3xl">
        {props.mode === 'locked' ? (
          <div className="rounded-2xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {props.reason}
          </div>
        ) : (
          <Composer {...props} />
        )}
      </div>
    </div>
  );
}

function Composer(props: Exclude<ComposerProps, { mode: 'locked' }>) {
  const isNew = props.mode === 'new';
  const [state, action, pending] = useActionState<ActionState, FormData>(isNew ? submitTask : reviseTask, {});
  const [text, setText] = useState('');
  const [type, setType] = useState<TaskType>('work');
  const [start, setStart] = useState(true);
  const form = useRef<HTMLFormElement>(null);
  const preset = PRESETS[type];
  const body = text.trim();
  const message = isNew && preset.preamble && body ? `${preset.preamble}\n\n${body}` : body;

  // A sent revision note leaves the box empty for the next one.
  useEffect(() => {
    if (state.message) setText('');
  }, [state]);

  return (
    <form ref={form} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="project" value={props.project} />
      {props.mode === 'revise' && <input type="hidden" name="id" value={props.id} />}
      <input type="hidden" name={isNew ? 'prompt' : 'note'} value={message} />
      {isNew && start && <input type="hidden" name="start" value="on" />}

      {isNew && (
        <div role="radiogroup" aria-label="Task type" className="flex flex-wrap gap-1.5">
          {ORDER.map((t) => {
            const { label, icon: Icon } = PRESETS[t];
            return (
              <Button
                key={t}
                type="button"
                role="radio"
                aria-checked={t === type}
                variant="ghost"
                size="sm"
                className={cn(
                  'rounded-full pointer-coarse:h-11 pointer-coarse:px-4',
                  t === type
                    ? 'bg-primary/10 text-primary ring-1 ring-primary/25 hover:bg-primary/15 hover:text-primary'
                    : 'text-muted-foreground',
                )}
                onClick={() => setType(t)}
              >
                <Icon aria-hidden />
                {label}
              </Button>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border bg-background shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
        <label htmlFor="chat-input" className="sr-only">
          {isNew ? 'New task' : 'Message the agent'}
        </label>
        <Textarea
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && body && !pending) {
              e.preventDefault();
              form.current?.requestSubmit();
            }
          }}
          placeholder={
            isNew
              ? preset.placeholder
              : 'Ask for changes. The coder gets your note, then verification and review run again.'
          }
          autoFocus
          rows={2}
          className="max-h-60 min-h-14 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          {isNew && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="switch"
              aria-checked={start}
              onClick={() => setStart((s) => !s)}
              title="Classify, code, verify and review right after submitting"
              className={cn('rounded-full', !start && 'text-muted-foreground')}
            >
              <Play aria-hidden />
              {start ? 'Run now' : 'Queue only'}
            </Button>
          )}
          <span className="hidden text-xs text-muted-foreground sm:inline">↵ to send · ⇧↵ new line</span>
          <div className="ml-auto flex items-center gap-2">
            {(state.error || state.message) && (
              <p
                role={state.error ? 'alert' : 'status'}
                className={cn('text-xs', state.error ? 'text-destructive' : 'text-muted-foreground')}
              >
                {state.error ?? state.message}
              </p>
            )}
            <Button
              type="submit"
              size="icon"
              className="rounded-full pointer-coarse:size-11"
              disabled={!body || pending}
              aria-label={isNew ? 'Start task' : 'Send revision note'}
            >
              {pending ? <LoaderCircle className="motion-safe:animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
