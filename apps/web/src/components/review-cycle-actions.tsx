'use client';
// The buttons of a review ticket: start a round, and pick what to post for a proposal.
import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { decideReview, moveIssue, restartSelfReview } from '@/app/actions';
import { Button } from '@/components/ui/button';

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<{ error?: string; message?: string }>();
  const act = (id: string, call: () => Promise<{ error?: string; message?: string }>) => {
    setBusy(id);
    start(async () => {
      const result = await call();
      setNotice(result);
      setBusy(undefined);
      router.refresh();
    });
  };
  return { pending, busy, notice, act };
}

function Notice({ notice }: { notice?: { error?: string; message?: string } }) {
  if (!notice?.error && !notice?.message) return null;
  return (
    <p
      role={notice.error ? 'alert' : 'status'}
      className={notice.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
    >
      {notice.error ?? notice.message}
    </p>
  );
}

export function StartReviewButton({
  project,
  issueKey,
  label,
}: {
  project: string;
  issueKey: string;
  label: string;
}) {
  const { pending, busy, notice, act } = useAct();
  return (
    <div className="flex items-center gap-2">
      <Notice notice={notice} />
      <Button
        size="sm"
        disabled={pending}
        onClick={() => act('start', () => moveIssue(project, issueKey, 'in_progress'))}
      >
        {busy === 'start' && <LoaderCircle className="size-3.5 motion-safe:animate-spin" />}
        {label}
      </Button>
    </div>
  );
}

export function ReviewDecisionButtons({
  project,
  issueKey,
  options,
}: {
  project: string;
  issueKey: string;
  options: { id: string; label: string; tone: 'primary' | 'default' | 'danger' }[];
}) {
  const { pending, busy, notice, act } = useAct();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="What to post">
      {options.map((o) => (
        <Button
          key={o.id}
          size="sm"
          variant={
            o.tone === 'primary'
              ? 'default'
              : o.tone === 'danger'
                ? 'destructive'
                : o.id === 'nothing'
                  ? 'ghost'
                  : 'outline'
          }
          disabled={pending}
          onClick={() => act(o.id, () => decideReview(project, issueKey, o.id))}
        >
          {busy === o.id && <LoaderCircle className="size-3.5 motion-safe:animate-spin" />}
          {o.label}
        </Button>
      ))}
      <Notice notice={notice} />
    </div>
  );
}

export function RestartSelfReviewButton({ project, runId }: { project: string; runId: string }) {
  const { pending, busy, notice, act } = useAct();
  return (
    <div className="flex items-center gap-2">
      <Notice notice={notice} />
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => act('restart', () => restartSelfReview(project, runId))}
      >
        {busy === 'restart' && <LoaderCircle className="size-3.5 motion-safe:animate-spin" />}
        Review again
      </Button>
    </div>
  );
}
