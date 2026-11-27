'use client';
// A form bound to a server action, showing pending state and the action's result or error.
// With `command`, it posts to the task commands route instead (see that route for why): the app
// stays usable while the command runs, and a toast reports the outcome on whatever page you are on.
import { useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@factory/ui/components/button';
import { toast } from '@factory/ui/components/toast';
import type { ActionState } from '@/app/actions';
import type { TaskCommand } from '@/app/api/projects/[project]/tasks/[id]/commands/route';

export interface BackgroundCommand {
  name: TaskCommand;
  /** The toast while it runs, e.g. "Opening the pull request for CE-12". */
  title: string;
}

/** Posts a task command and reports it in a toast; resolves to the command's result. */
export async function runCommand(command: BackgroundCommand, form: FormData): Promise<ActionState> {
  const project = String(form.get('project') ?? '');
  const id = String(form.get('id') ?? '');
  form.set('command', command.name);
  const request = fetch(
    `/api/projects/${encodeURIComponent(project)}/tasks/${encodeURIComponent(id)}/commands`,
    { method: 'POST', body: form },
  ).then(async (response) => {
    const state = (await response.json().catch(() => ({}))) as ActionState;
    if (!response.ok) throw new Error(state.error ?? `The command failed (${response.status}).`);
    return state;
  });
  try {
    return await toast.promise(request, {
      loading: { title: command.title },
      success: (state: ActionState) => ({ title: state.message ?? 'Done.' }),
      error: (error: unknown) => ({
        title: `${command.title.replace(/…$/, '')} failed`,
        description: error instanceof Error ? error.message : String(error),
      }),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function ActionForm({
  action,
  command,
  hidden,
  submit,
  pendingLabel,
  variant = 'default',
  children,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  /** Run as a background command (approve, open the pull request, reject) instead of `action`. */
  command?: BackgroundCommand;
  hidden: Record<string, string>;
  submit: string;
  pendingLabel?: string;
  variant?: 'default' | 'outline' | 'destructive' | 'secondary';
  children?: ReactNode;
}) {
  const [actionState, formAction, actionPending] = useActionState(action, {});
  const [commandState, setCommandState] = useState<ActionState>({});
  const [commandPending, setCommandPending] = useState(false);
  const router = useRouter();
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!command) return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const page = window.location.pathname;
    setCommandPending(true);
    setCommandState({});
    void runCommand(command, form).then((state) => {
      // Refresh only the page that sent it; another page reads fresh data on its own.
      if (window.location.pathname === page) router.refresh();
      if (!mounted.current) return;
      setCommandPending(false);
      setCommandState(state);
    });
  };
  const state = command ? commandState : actionState;
  const pending = command ? commandPending : actionPending;
  return (
    <form action={command ? undefined : formAction} onSubmit={onSubmit} className="flex flex-col gap-3">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <div className="flex items-center gap-3">
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? (pendingLabel ?? 'Working…') : submit}
        </Button>
        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : state.message ? (
          <p role="status" className="text-sm text-muted-foreground">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
