'use client';
// A form bound to a server action, showing pending state and the action's result or error.
import { useActionState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/app/actions';

export function ActionForm({
  action,
  hidden,
  submit,
  pendingLabel,
  variant = 'default',
  children,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  submit: string;
  pendingLabel?: string;
  variant?: 'default' | 'outline' | 'destructive' | 'secondary';
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
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
