'use client';
import { useActionState } from 'react';
import { featureGateAction, type ActionState } from '@/app/actions';
import { Button } from '@/components/ui/button';

export function FeatureGate({
  project,
  id,
  action,
  label,
}: {
  project: string;
  id: string;
  action: 'approve-spec' | 'plan' | 'approve-board';
  label: string;
}) {
  const [state, submit, pending] = useActionState<ActionState, FormData>(featureGateAction, {});
  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      {action === 'approve-board' && (
        <label className="text-sm">
          <input type="checkbox" name="mirror" /> Create tickets in task manager
        </label>
      )}
      <Button type="submit" disabled={pending}>
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
  );
}
