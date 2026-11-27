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
  Square,
  type LucideIcon,
} from 'lucide-react';
import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { reviseTask, stopTask, submitTask, type ActionState } from '@/app/actions';
import { HoldButton } from '@/components/bits/hold-button';
import { Button } from '@factory/ui/components/button';
import { Toggle } from '@factory/ui/components/toggle';
import { ToggleGroup, ToggleGroupItem } from '@factory/ui/components/toggle-group';
import { Input } from '@factory/ui/components/input';
import { Textarea } from '@factory/ui/components/textarea';
import { useUserPreferences } from '@/components/user-preferences';
import { cn } from '@factory/ui/lib/utils';

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
  | { mode: 'locked'; reason: string }
  | { mode: 'running'; project: string; id: string; reason: string };

/** `className` adjusts the outer frame; the home page drops its padding to share the page column. */
export function TaskChatComposer({ className, ...props }: ComposerProps & { className?: string }) {
  return (
    <div className={cn('shrink-0 px-6 pb-5', className)}>
      <div className="mx-auto max-w-3xl">
        {props.mode === 'locked' ? (
          <div className="rounded-2xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {props.reason}
          </div>
        ) : props.mode === 'running' ? (
          <RunningComposer {...props} />
        ) : (
          <Composer {...props} />
        )}
      </div>
    </div>
  );
}

/** While a run works: the reason you cannot send, and the send button turned into Stop. */
function RunningComposer({ project, id, reason }: Extract<ComposerProps, { mode: 'running' }>) {
  const [state, action, pending] = useActionState<ActionState, FormData>(stopTask, {});
  const stopping = pending || Boolean(state.message);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      action={action}
      className="flex items-center gap-3 rounded-2xl border bg-muted/40 py-2 pr-2 pl-4 text-sm text-muted-foreground"
    >
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="id" value={id} />
      <p className="min-w-0 flex-1" role={state.error ? 'alert' : 'status'}>
        {state.error ? (
          <span className="text-destructive">{state.error}</span>
        ) : stopping ? (
          'Stopping the run. The page updates when it ends.'
        ) : (
          reason
        )}
      </p>
      {stopping ? (
        <Button
          size="icon"
          variant="destructive"
          className="shrink-0 rounded-full pointer-coarse:size-11"
          disabled
          aria-label="Stopping the run"
        >
          <LoaderCircle className="motion-safe:animate-spin" />
        </Button>
      ) : (
        // A short hold, so a slip of the cursor does not kill a working agent.
        <HoldButton
          size="icon"
          radius={999}
          fillDirection="up"
          holdTime={800}
          backgroundColor="color-mix(in srgb, var(--destructive) 14%, transparent)"
          textColor="var(--destructive)"
          fillColor="var(--destructive)"
          fillTextColor="var(--background)"
          glow={false}
          waveAmplitude={3}
          resetAfter={0}
          doneLabel={<Square className="fill-current" aria-hidden />}
          aria-label="Hold to stop the run"
          title="Hold to stop the run"
          onHold={() => form.current?.requestSubmit()}
        >
          <Square className="fill-current" aria-hidden />
        </HoldButton>
      )}
    </form>
  );
}

function Composer(props: Exclude<ComposerProps, { mode: 'locked' | 'running' }>) {
  const isNew = props.mode === 'new';
  const [state, action, pending] = useActionState<ActionState, FormData>(isNew ? submitTask : reviseTask, {});
  const [text, setText] = useState('');
  const defaults = useUserPreferences().tasks;
  const [type, setType] = useState<TaskType>(defaults.default_type);
  const [start, setStart] = useState(defaults.start_runs);
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
      {/* The task keeps your words; the preset's instructions go along separately, for the agent. */}
      {isNew && (
        <>
          <input
            type="hidden"
            name="title"
            value={
              body
                .split('\n')
                .find((l) => l.trim())
                ?.trim() ?? ''
            }
          />
          <input type="hidden" name="body" value={body} />
          {type !== 'work' && preset.preamble && (
            <input type="hidden" name="instructions" value={preset.preamble} />
          )}
        </>
      )}

      {isNew && (
        <ToggleGroup
          aria-label="Task type"
          value={[type]}
          // One type is always chosen: pressing the current one again keeps it.
          onValueChange={(next) => next[0] && setType(next[0] as typeof type)}
          spacing={1.5}
          className="flex-wrap"
        >
          {ORDER.map((t) => {
            const { label, icon: Icon } = PRESETS[t];
            return (
              <ToggleGroupItem
                key={t}
                value={t}
                size="sm"
                className="rounded-full text-muted-foreground pointer-coarse:h-11 pointer-coarse:px-4 data-pressed:bg-primary/10 data-pressed:text-primary data-pressed:ring-1 data-pressed:ring-primary/25 data-pressed:hover:bg-primary/15"
              >
                <Icon aria-hidden />
                {label}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      )}

      {isNew && type === 'work' && defaults.jira_key_field && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <label htmlFor="jira-key" className="text-muted-foreground">
            Jira issue key
          </label>
          <Input
            id="jira-key"
            name="jira_key"
            maxLength={100}
            spellCheck={false}
            placeholder="PROJECT-123"
            className="h-7 w-36 font-mono md:text-xs"
          />
          <span className="text-xs text-muted-foreground">Optional</span>
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
            <Toggle
              size="sm"
              pressed={start}
              onPressedChange={setStart}
              title={
                start
                  ? 'Adds the task to Todo: its agent, or the one Mika picks, starts it'
                  : 'Adds the task to Backlog; move it to Todo when it is ready'
              }
              className="rounded-full text-muted-foreground data-pressed:bg-transparent data-pressed:text-foreground"
            >
              <Play aria-hidden />
              {start ? 'Start' : 'Backlog'}
            </Toggle>
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
              aria-label={
                isNew
                  ? start
                    ? 'Create the task and start a run'
                    : 'Add the task to the board'
                  : 'Send revision note'
              }
            >
              {pending ? <LoaderCircle className="motion-safe:animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
