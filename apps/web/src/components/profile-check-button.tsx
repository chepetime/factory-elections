'use client';
import { LoaderCircle, PlayCircle } from 'lucide-react';
import { useActionState } from 'react';
import { checkProjectSetup, type ActionState } from '@/app/actions';
import { Button } from '@/components/ui/button';

export function ProfileCheckButton({ project, running }: { project: string; running: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(checkProjectSetup, {});
  const busy = running || pending;
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="project" value={project} />
      <Button type="submit" variant="outline" size="sm" disabled={busy}>
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
