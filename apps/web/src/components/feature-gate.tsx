'use client';
import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { featureGateAction, type ActionState } from '@/app/actions';
import { useConfirm, type ConfirmRequest } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/** The feature commands the page can send; the backend lists which ones a feature accepts now. */
export type FeatureGateAction =
  | 'grill'
  | 'skip-grill'
  | 'write-spec'
  | 'approve-spec'
  | 'plan'
  | 'approve-board'
  | 'mark-merged'
  | 'retry-ticket'
  | 'write-qa'
  | 'complete'
  | 'cancel';

export function FeatureGate({
  project,
  id,
  action,
  label,
  ticket,
  answer,
  variant = 'default',
  confirm,
}: {
  project: string;
  id: string;
  action: FeatureGateAction;
  label: string;
  /** The ticket of a ticket command. */
  ticket?: string;
  /** Shows a required text field with this label: the answer to the agent's question. */
  answer?: string;
  variant?: 'default' | 'outline' | 'destructive';
  /** Asks before it sends, for a command that cannot be undone. */
  confirm?: ConfirmRequest;
}) {
  // The answer is controlled, so a refused command keeps the draft; only a sent answer clears it.
  const [text, setText] = useState('');
  const [state, submit, pending] = useActionState<ActionState, FormData>(async (previous, form) => {
    const result = await featureGateAction(previous, form);
    if (!result.error) setText('');
    return result;
  }, {});
  const [ask, dialog] = useConfirm();
  const confirmFirst = async (event: FormEvent<HTMLFormElement>) => {
    if (!confirm) return;
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await ask(confirm)) startTransition(() => submit(data));
  };
  return (
    <>
      <form action={submit} onSubmit={confirmFirst} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="project" value={project} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="action" value={action} />
        {ticket && <input type="hidden" name="ticket" value={ticket} />}
        {answer && (
          <Textarea
            name="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            required
            rows={3}
            aria-label={answer}
            placeholder={answer}
            className="basis-full"
          />
        )}
        {action === 'approve-board' && (
          <label className="text-sm">
            <input type="checkbox" name="mirror" /> Create tickets in task manager
          </label>
        )}
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? 'Working…' : label}
        </Button>
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        {state.message && (
          <p role="status" className="text-sm">
            {state.message}
          </p>
        )}
      </form>
      {dialog}
    </>
  );
}
