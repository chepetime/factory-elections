'use client';
// The repo profile's state in the Setup check pane, with a button that drafts a missing profile.
import { CircleAlert, CircleCheck, CircleDashed, FileText, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { draftProfile } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ProfileState =
  | { state: 'missing'; path: string }
  | { state: 'draft'; path: string }
  | { state: 'approved'; path: string; approved_at: string }
  | { state: 'invalid'; path: string; error: string };

const LOOK = {
  missing: { icon: CircleDashed, tone: 'text-muted-foreground', label: 'No repo profile' },
  draft: { icon: FileText, tone: 'text-amber-700 dark:text-amber-400', label: 'Draft, not approved' },
  approved: { icon: CircleCheck, tone: 'text-green-700 dark:text-green-400', label: 'Approved' },
  invalid: { icon: CircleAlert, tone: 'text-destructive', label: 'Profile invalid' },
} as const;

export function ProfileStatusRow({ project, status }: { project: string; status: ProfileState }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const { icon: Icon, tone, label } = LOOK[status.state];
  return (
    <div className="flex flex-col gap-2 border-b pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm">
          <Icon className={cn('size-4 shrink-0', tone)} aria-hidden />
          <span className="font-medium">Repo profile:</span>
          <span className={tone}>
            {label}
            {status.state === 'approved' && ` on ${status.approved_at}`}
          </span>
        </p>
        {status.state === 'missing' && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await draftProfile(project);
                setError(result.error);
                router.refresh();
              })
            }
          >
            {pending ? (
              <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
            ) : (
              <FileText aria-hidden />
            )}
            {pending ? 'Drafting…' : 'Draft profile'}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {status.state === 'missing'
          ? 'Every run needs an approved profile: the base branch, the test and check commands, and the paths the coder may not touch. Draft one from the repository; no model is called.'
          : status.state === 'draft'
            ? 'Review the draft, fix any command that is wrong, then set approved_at to today’s date. Runs and the setup check wait until then.'
            : status.state === 'invalid'
              ? status.error
              : 'Runs use this profile. Edit the file to change it.'}
      </p>
      {status.state !== 'missing' && (
        <p className="truncate font-mono text-xs text-muted-foreground" title={status.path}>
          {status.path}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
