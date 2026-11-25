import { FeatureId, type FeatureCommand } from '@factory/core';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/auto-refresh';
import { FeatureBoardEditor } from '@/components/feature-board-editor';
import { FeatureGate } from '@/components/feature-gate';
import { isProjectName } from '@/lib/factory';
import { getFeature } from '@/lib/features';
export const dynamic = 'force-dynamic';

const STAGE_LABELS: Record<string, string> = {
  grilling: 'Questions',
  spec: 'Specification',
  'spec-approved': 'Specification approved',
  board: 'Board',
  implementing: 'In progress',
  qa: 'QA',
  done: 'Done',
  cancelled: 'Cancelled',
};
const STEP_LABELS: Record<string, string> = {
  grill: 'The agent reads your answer',
  'write-spec': 'The agent writes the specification',
  plan: 'The agent plans the board',
  'write-qa': 'The agent writes the QA plan',
};
const TICKET_LABELS: Record<string, string> = {
  waiting: 'Waiting for its blockers',
  'waiting-merge': 'Waiting for its blockers to merge',
  running: 'In progress',
  done: 'Ready for review',
  failed: 'Failed',
};

export default async function FeaturePage({ params }: { params: Promise<{ project: string; id: string }> }) {
  const { project, id } = await params;
  if (!isProjectName(project) || !FeatureId.safeParse(id).success) notFound();
  const f = await getFeature(project, id);
  // The backend lists what the feature accepts now; the page keeps no stage rules of its own.
  const actions = new Map(f.actions.map((a) => [a.action, a]));
  const can = (action: FeatureCommand) => actions.get(action)?.allowed === true;
  const accepts = (action: FeatureCommand, ticket: string) =>
    can(action) && actions.get(action)!.tickets?.includes(ticket) === true;
  const gate = { project, id };
  const asked = f.grill.turns.length > 0;
  const started = Boolean(f.tickets.some((t) => t.task_id) || f.qa);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      {f.working && <AutoRefresh />}
      <div>
        <h1 className="text-2xl font-semibold">{f.title}</h1>
        <p className="text-sm text-muted-foreground" role="status">
          {STAGE_LABELS[f.stage] ?? f.stage}
          {f.working ? ` · ${STEP_LABELS[f.working.action] ?? `${f.working.action} in progress`}…` : ''}
        </p>
      </div>
      {f.error && (
        <p role="alert" className="text-destructive">
          {f.error}
        </p>
      )}
      {(asked || can('grill') || can('skip-grill')) && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">Questions</h2>
          {asked ? (
            <ol className="space-y-3">
              {f.grill.turns.map((turn) => (
                <li key={`${turn.at}-${turn.role}`}>
                  <p className="text-xs text-muted-foreground">{turn.role === 'agent' ? 'Agent' : 'You'}</p>
                  <p className="whitespace-pre-wrap break-words text-sm">{turn.text}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p>The agent asks one question at a time before it writes the specification.</p>
          )}
          {can('grill') && (
            <FeatureGate
              {...gate}
              action="grill"
              label={asked ? 'Send answer' : 'Start the questions'}
              {...(asked ? { answer: 'Your answer' } : {})}
            />
          )}
          {can('skip-grill') && (
            <FeatureGate {...gate} action="skip-grill" label="Skip the questions" variant="outline" />
          )}
        </section>
      )}
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">Specification</h2>
        {f.spec ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{f.spec}</pre>
        ) : (
          <p>No specification yet.</p>
        )}
        {f.critique && (
          <>
            <h3 className="font-medium">Critique</h3>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{f.critique}</pre>
          </>
        )}
        {can('approve-spec') && <FeatureGate {...gate} action="approve-spec" label="Approve specification" />}
        {can('write-spec') && (
          <FeatureGate
            {...gate}
            action="write-spec"
            label={f.spec ? 'Write specification again' : 'Write specification'}
            variant={can('approve-spec') ? 'outline' : 'default'}
          />
        )}
        {can('save-spec') && f.spec && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Edit specification</summary>
            <div className="mt-3">
              <FeatureGate
                {...gate}
                // A new specification text starts a new editor.
                key={f.spec}
                action="save-spec"
                label={f.stage === 'spec-approved' ? 'Save and approve again' : 'Save specification'}
                variant="outline"
                edit={{ label: 'Specification', text: f.spec }}
              />
            </div>
          </details>
        )}
        {can('plan') && f.tickets.length === 0 && <FeatureGate {...gate} action="plan" label="Plan board" />}
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">Board</h2>
        {f.tickets.length === 0 ? (
          <p>No tickets planned yet.</p>
        ) : (
          <ul className="space-y-4">
            {f.tickets.map((t) => (
              <li key={t.id} className="space-y-1 border-t pt-3">
                <h3 className="font-medium">
                  {t.id}: {t.title} ({t.size})
                </h3>
                <p className="whitespace-pre-wrap text-sm">{t.description}</p>
                <ul className="list-disc pl-5 text-sm">
                  {t.acceptance.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground">
                  Blocked by: {t.blocked_by.join(', ') || 'none'}
                  {started ? ` · ${TICKET_LABELS[t.state] ?? t.state}` : ''}
                </p>
                {t.error && t.state === 'failed' && (
                  <p className="whitespace-pre-wrap break-words text-sm text-destructive">{t.error}</p>
                )}
                {accepts('retry-ticket', t.id) && (
                  <FeatureGate {...gate} action="retry-ticket" ticket={t.id} label={`Run ${t.id} again`} />
                )}
                {accepts('mark-merged', t.id) && (
                  <FeatureGate
                    {...gate}
                    action="mark-merged"
                    ticket={t.id}
                    label="Its blockers are merged"
                    variant="outline"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {can('save-board') && f.tickets.length > 0 && (
          <FeatureBoardEditor
            {...gate}
            // A new plan starts a new editor.
            key={f.tickets.map((t) => `${t.id}:${t.title}`).join('|')}
            tickets={f.tickets}
          />
        )}
        {can('approve-board') && (
          <FeatureGate {...gate} action="approve-board" label="Approve board and start work" />
        )}
        {can('plan') && f.tickets.length > 0 && (
          <FeatureGate {...gate} action="plan" label="Plan board again" variant="outline" />
        )}
      </section>
      {(f.qa || can('write-qa') || can('complete')) && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">QA plan</h2>
          {f.qa ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{f.qa}</pre>
          ) : (
            <p>The agent writes the QA plan when every ticket is ready for review.</p>
          )}
          {can('complete') && <FeatureGate {...gate} action="complete" label="Complete feature" />}
          {can('write-qa') && (
            <FeatureGate
              {...gate}
              action="write-qa"
              label={f.qa ? 'Write QA plan again' : 'Write QA plan now'}
              variant="outline"
            />
          )}
        </section>
      )}
      {can('cancel') && (
        <FeatureGate
          {...gate}
          action="cancel"
          label="Cancel feature"
          variant="destructive"
          confirm={{
            title: 'Cancel this feature?',
            body: 'The feature accepts no more commands. Its live runs stop and its other open runs are rejected. Pull requests that are already open stay open.',
            confirm: 'Cancel feature',
            cancel: 'Keep feature',
            tone: 'destructive',
          }}
        />
      )}
    </main>
  );
}
