'use client';
import { PlayCircle } from 'lucide-react';
import { useActionState } from 'react';
import { checkProjectSetup, type ActionState } from '@/app/actions';
import { LatticeLoader } from '@/components/bits/lattice-loader';
import { Button } from '@factory/ui/components/button';

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
          <LatticeLoader label="Checking…" fontSize={13} />
        ) : (
          <>
            <PlayCircle aria-hidden /> Check setup
          </>
        )}
      </Button>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
