'use client';
import { LoaderCircle, PlayCircle } from 'lucide-react';
import { useActionState } from 'react';
import { checkProjectSetup, type ActionState } from '@/app/actions';
import { Button } from '@/components/ui/button';

export function ProfileCheckButton({
  project,
  running,
  blocked,
}: {
  project: string;
  running: boolean;
  blocked?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(checkProjectSetup, {});
  const busy = running || pending;
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="project" value={project} />
      {blocked && !busy && <p className="text-xs text-muted-foreground">{blocked}</p>}
      <Button type="submit" variant="outline" size="sm" disabled={busy || !!blocked}>
        {busy ? (
          <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
        ) : (
          <PlayCircle aria-hidden />
        )}
        {busy ? 'Checking…' : 'Check setup'}
      </Button>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
