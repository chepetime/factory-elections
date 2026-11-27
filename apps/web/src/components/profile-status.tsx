'use client';
// The repo profile's state in the Setup check pane: draft a missing profile, or review and approve a draft.
import { CircleAlert, CircleCheck, CircleDashed, FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { approveProfile, draftProfile, type ActionState } from '@/app/actions';
import { useConfirm } from '@/components/confirm-dialog';
import { LatticeLoader } from '@factory/ui/components/lattice-loader';
import { Button } from '@factory/ui/components/button';
import type { ProfileStatus } from '@/lib/settings';
import { cn } from '@factory/ui/lib/utils';

export type ProfileState = ProfileStatus;
type Summary = Extract<ProfileStatus, { state: 'draft' }>['summary'];

const LOOK = {
  missing: { icon: CircleDashed, tone: 'text-muted-foreground', label: 'No repo profile' },
  draft: { icon: FileText, tone: 'text-amber-700 dark:text-amber-400', label: 'Draft, not approved' },
  approved: { icon: CircleCheck, tone: 'text-green-700 dark:text-green-400', label: 'Approved' },
  invalid: { icon: CircleAlert, tone: 'text-destructive', label: 'Profile invalid' },
} as const;

function SummaryList({ summary }: { summary: Summary }) {
  const rows: [string, string][] = [
    ['Base branch', summary.base_branch],
    ...(summary.setup ? ([['Setup', summary.setup]] as [string, string][]) : []),
    ['Test', summary.test],
    ['Full check', summary.full_check],
    ['Forbidden paths', summary.forbidden_paths.join(', ') || 'None'],
  ];
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-mono text-xs leading-5 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProfileStatusRow({ project, status }: { project: string; status: ProfileState }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState>({});
  const [confirm, confirmDialog] = useConfirm();
  const { icon: Icon, tone, label } = LOOK[status.state];
  const act = (run: () => Promise<ActionState>) =>
    start(async () => {
      setResult(await run());
      router.refresh();
    });
  const approve = async () => {
    if (status.state !== 'draft') return;
    const yes = await confirm({
      title: 'Approve this profile?',
      body: (
        <span className="flex flex-col gap-3">
          <span>Every run uses these values. To change one, edit the file first.</span>
          <SummaryList summary={status.summary} />
        </span>
      ),
      confirm: 'Approve',
    });
    if (yes) act(() => approveProfile(project));
  };

  return (
    <div className="flex flex-col gap-3 border-b pb-4">
      {confirmDialog}
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
            onClick={() => act(() => draftProfile(project))}
          >
            {pending ? (
              <LatticeLoader label="Drafting…" fontSize={13} />
            ) : (
              <>
                <FileText aria-hidden /> Draft profile
              </>
            )}
          </Button>
        )}
        {status.state === 'draft' && (
          <Button size="sm" disabled={pending} onClick={approve}>
            {pending ? (
              <LatticeLoader label="Approving…" fontSize={13} showTimer={false} />
            ) : (
              <>
                <CircleCheck aria-hidden /> Approve profile
              </>
            )}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {status.state === 'missing'
          ? 'Every run needs an approved profile: the base branch, the test and check commands, and the paths the coder may not touch. Draft one from the repository; no model is called.'
          : status.state === 'draft'
            ? 'Check these values. To change one, edit the file, then reload this page. Runs and the setup check wait until you approve.'
            : status.state === 'invalid'
              ? status.error
              : 'Runs use this profile. Edit the file to change it.'}
      </p>
      {status.state === 'draft' && <SummaryList summary={status.summary} />}
      {status.state !== 'missing' && (
        <p className="truncate font-mono text-xs text-muted-foreground" title={status.path}>
          {status.path}
        </p>
      )}
      {(result.error || result.message) && (
        <p
          role={result.error ? 'alert' : 'status'}
          className={cn('text-sm', result.error ? 'text-destructive' : 'text-muted-foreground')}
        >
          {result.error ?? result.message}
        </p>
      )}
    </div>
  );
}
