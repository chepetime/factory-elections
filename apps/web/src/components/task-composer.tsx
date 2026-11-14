'use client';
// New-task composer. Layout inspired by Affect UI's Chat Composer
// (https://www.affectui.com/components/chat-composer); original implementation, no Affect UI source or assets.
import { ArrowUp, FolderGit2, Play, ShieldCheck } from 'lucide-react';
import { useActionState, useRef, useState } from 'react';
import { submitTask, type ActionState } from '@/app/actions';
import { cn } from '@/lib/utils';

export function TaskComposer({ project }: { project: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitTask, {});
  const [text, setText] = useState('');
  const [start, setStart] = useState(true);
  const form = useRef<HTMLFormElement>(null);
  const empty = text.trim().length === 0;

  return (
    <form ref={form} action={action} className="rounded-2xl border bg-muted/40 shadow-xs">
      <input type="hidden" name="project" value={project} />
      {start && <input type="hidden" name="start" value="on" />}
      <div className="rounded-2xl border-b bg-background px-4 pt-3 pb-2 shadow-xs">
        <label htmlFor="prompt" className="sr-only">
          New task
        </label>
        <textarea
          id="prompt"
          name="prompt"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !empty) {
              e.preventDefault();
              form.current?.requestSubmit();
            }
          }}
          rows={2}
          placeholder="Describe one change for this repository…"
          className="field-sizing-content block max-h-60 min-h-12 w-full resize-none overflow-y-auto bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={start}
            onClick={() => setStart((s) => !s)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors',
              start ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
            title="Classify, code, verify and review right after submitting"
          >
            <Play className="size-3.5" aria-hidden />
            {start ? 'Run now' : 'Queue only'}
          </button>
          <span className="hidden text-xs text-muted-foreground sm:inline">⌘↵ to submit</span>
          <div className="ml-auto flex items-center gap-3">
            {state.error && (
              <p role="alert" className="text-xs text-destructive">
                {state.error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending || empty}
              aria-label="Submit task"
              className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
            >
              <ArrowUp className={cn('size-4', pending && 'animate-pulse')} aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <FolderGit2 className="size-3.5" aria-hidden />
          {project}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" aria-hidden />
          Stops for your approval before anything is pushed
        </span>
      </div>
    </form>
  );
}
