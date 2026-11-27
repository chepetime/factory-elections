'use client';
// The two buttons of the memory page. Each asks the server action to do its work and shows the error the
// backend gave when it cannot; Remove asks first, because agents stop being told the fact.
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-dialog';

function useAction(run: () => Promise<{ error?: string }>) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const go = () =>
    start(async () => {
      const result = await run().catch((e: unknown) => ({
        error: e instanceof Error ? e.message : String(e),
      }));
      // The action revalidates the page, so a success needs no refresh here.
      setError(result.error);
    });
  return { pending, error, go };
}

const Failure = ({ error }: { error?: string }) =>
  error ? (
    <p role="alert" className="text-xs text-destructive">
      {error}
    </p>
  ) : null;

export function RemoveFact({
  project,
  id,
  text,
  forget,
}: {
  project: string;
  id: string;
  text: string;
  forget: (project: string, id: string) => Promise<{ error?: string }>;
}) {
  const [confirm, dialog] = useConfirm();
  const { pending, error, go } = useAction(() => forget(project, id));
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={async () => {
          const yes = await confirm({
            title: 'Remove this fact?',
            body: (
              <>
                Agents stop being told <q>{text}</q>. It stays on this page under Removed, so a later review
                does not propose it again.
              </>
            ),
            confirm: 'Remove fact',
            tone: 'destructive',
          });
          if (yes) go();
        }}
      >
        {pending ? 'Removing…' : 'Remove'}
      </Button>
      <Failure error={error} />
      {dialog}
    </div>
  );
}

export function RestoreToolsButton({
  project,
  restore,
}: {
  project: string;
  restore: (project: string) => Promise<{ error?: string }>;
}) {
  const { pending, error, go } = useAction(() => restore(project));
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={go}>
        {pending ? 'Restoring…' : 'Restore tools'}
      </Button>
      <Failure error={error} />
    </div>
  );
}
