import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { blockingFindings, type TaskRecord } from '@factory/core';
import { approveTask, dismissLog, openPullRequest, rejectTask, reviseTask, runTask } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { AutoRefresh } from '@/components/auto-refresh';
import { StageBadge } from '@/components/stage-badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  backgroundRun,
  isProjectName,
  isTaskId,
  readDiff,
  readGate,
  showTask,
  type Gate,
} from '@/lib/factory';

export const dynamic = 'force-dynamic';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = title.toLowerCase().replace(/\W+/g, '-');
  return (
    <section aria-labelledby={id} className="rounded-xl border p-4">
      <h2 id={id} className="mb-3 font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

const SEVERITY: Record<string, string> = {
  blocking: 'text-destructive font-semibold',
  major: 'text-destructive',
  minor: 'text-foreground',
  nit: 'text-muted-foreground',
};

/** First non-empty line of the prompt, shortened for a heading. */
function title(prompt: string): string {
  const line =
    prompt
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? prompt.trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

function PromptText({ prompt }: { prompt: string }) {
  const long = prompt.length > 600 || prompt.split('\n').length > 12;
  const body = (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6">{prompt}</pre>
  );
  if (!long) return body;
  return (
    <details>
      <summary className="cursor-pointer text-sm text-muted-foreground">
        Show full prompt ({prompt.split('\n').length} lines)
      </summary>
      <div className="mt-2">{body}</div>
    </details>
  );
}

function money(task: TaskRecord): string {
  const attempts = task.attempts ?? [];
  if (attempts.length === 0) return '—';
  if (attempts.some((a) => a.cost_usd === null)) return 'unknown';
  return `$${attempts.reduce((sum, a) => sum + (a.cost_usd ?? 0), 0).toFixed(2)}`;
}

export default async function TaskPage({ params }: { params: Promise<{ project: string; id: string }> }) {
  const { project, id } = await params;
  if (!isProjectName(project) || !isTaskId(id)) notFound();
  const shown = await showTask(project, id);
  if (!shown.ok) {
    return (
      <div className="flex flex-col gap-3">
        <Link href={`/projects/${project}/tasks`} className="text-sm text-muted-foreground hover:underline">
          ← Tasks: {project}
        </Link>
        <p className="text-destructive">Task unavailable: {shown.error}</p>
      </div>
    );
  }
  let task = shown.value;
  let gate: Gate | undefined;
  let gateError: string | undefined;
  let diff: string | undefined;
  if (task.worktree) {
    const g = await readGate(project, id);
    if (g.ok) {
      gate = g.value;
      task = gate.task;
      const d = await readDiff(project, id);
      diff = d.ok ? d.value : undefined;
    } else gateError = g.error;
  }
  const run = backgroundRun(project, id);
  const busy = run.running || task.stage === 'coding' || task.stage === 'reviewing';
  const hidden = { project, id };
  const blocking = blockingFindings(task);
  const canRevise =
    Boolean(task.worktree) &&
    !task.pr &&
    !busy &&
    ['awaiting-approval', 'verification-failed', 'failed', 'rejected', 'approved'].includes(task.stage);

  return (
    <div className="flex flex-col gap-6">
      {busy && <AutoRefresh />}
      <div className="flex flex-col gap-2">
        <Link href={`/projects/${project}/tasks`} className="text-sm text-muted-foreground hover:underline">
          ← Tasks: {project}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <h1 className="line-clamp-2 text-lg font-semibold">{title(task.prompt)}</h1>
          <StageBadge stage={task.stage} />
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {task.id} · model cost {money(task)}
        </p>
      </div>

      <Section title="Task">
        <PromptText prompt={task.prompt} />
      </Section>

      {(run.running || run.logTail) && (
        <Section title={run.running ? `In progress: ${run.label ?? 'running'}` : 'Last run log'}>
          {run.running && (
            <p className="mb-2 text-sm text-muted-foreground">This page refreshes every few seconds.</p>
          )}
          {run.running ? (
            <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
              {run.logTail || 'Starting…'}
            </pre>
          ) : (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">Show output</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
                {run.logTail}
              </pre>
            </details>
          )}
          {!run.running && (
            <form action={dismissLog} className="mt-2">
              <input type="hidden" name="project" value={project} />
              <input type="hidden" name="id" value={id} />
              <button className="text-xs text-muted-foreground hover:underline">Dismiss log</button>
            </form>
          )}
        </Section>
      )}

      {task.pr && (
        <Section title="Pull request">
          <a href={task.pr.url} className="text-sm font-medium underline" target="_blank" rel="noreferrer">
            {task.pr.url}
          </a>
          <p className="mt-1 text-xs text-muted-foreground">
            Opened from {task.pr.head_sha.slice(0, 12)} on {task.pr.branch}
          </p>
        </Section>
      )}

      {!task.worktree && !busy && task.stage !== 'blocked' && (
        <Section title="Run">
          <ActionForm action={runTask} hidden={hidden} submit="Run task" pendingLabel="Starting…">
            <p className="text-sm text-muted-foreground">
              Classifies, codes in a new worktree, verifies and reviews, then stops for your approval. Nothing
              is pushed.
            </p>
          </ActionForm>
        </Section>
      )}

      {task.verdict && (
        <Section title="Classifier">
          <p className="text-sm">
            Kind <b>{task.verdict.kind}</b> · size <b>{task.verdict.loe}</b> · Readiness:{' '}
            <b>{task.verdict.readiness}</b>
          </p>
          {task.verdict.blockers.length > 0 && (
            <>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {task.verdict.blockers.map((b, i) => (
                  <li key={i}>
                    <span className="font-medium">{b.kind}:</span> {b.question}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-muted-foreground">
                The task stopped before any code. Submit a clearer task that answers these questions.
              </p>
            </>
          )}
        </Section>
      )}

      {gateError && <p className="text-sm text-destructive">Gate unavailable: {gateError}</p>}

      {gate && (
        <Section title="Change">
          <p className="text-sm">
            <span className="font-mono">{task.worktree?.branch}</span> → {task.worktree?.base_branch}, head{' '}
            <span className="font-mono font-medium">{gate.head_sha.slice(0, 12)}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Worktree: <span className="font-mono">{task.worktree?.path}</span>
          </p>
          <pre className="mt-3 overflow-auto rounded-lg bg-muted p-3 text-xs">
            {gate.diff_stat || 'No changes yet.'}
          </pre>
          {diff && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">Full diff</summary>
              <pre className="mt-2 max-h-[32rem] overflow-auto rounded-lg bg-muted p-3 text-xs">
                {diff.split('\n').map((line, i) => (
                  <span
                    key={i}
                    className={
                      line.startsWith('+') && !line.startsWith('+++')
                        ? 'block text-green-700 dark:text-green-400'
                        : line.startsWith('-') && !line.startsWith('---')
                          ? 'block text-red-700 dark:text-red-400'
                          : 'block'
                    }
                  >
                    {line || ' '}
                  </span>
                ))}
              </pre>
            </details>
          )}
        </Section>
      )}

      {task.verification && (
        <Section title="Verification">
          <p className={`text-sm ${task.verification.passed ? '' : 'text-destructive'}`}>
            {task.verification.passed ? 'Passed' : 'Failed'} at{' '}
            <span className="font-mono">{task.verification.head_sha.slice(0, 12)}</span>
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm">Output</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
              {task.verification.output_tail}
            </pre>
          </details>
        </Section>
      )}

      {task.review && (
        <Section title="Review">
          <p className="text-sm">
            <b>{task.review.verdict}</b> at{' '}
            <span className="font-mono">{task.review.head_sha.slice(0, 12)}</span> — {task.review.summary}
          </p>
          {task.review.findings.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {task.review.findings.map((f, i) => (
                <li key={i} className="text-sm">
                  <span className={`uppercase text-xs ${SEVERITY[f.severity]}`}>{f.severity}</span>{' '}
                  {f.file && <span className="font-mono text-xs">{f.file}: </span>}
                  {f.message}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {gate && task.stage === 'awaiting-approval' && !busy && (
        <Section title="Your decision">
          {gate.blockers.length > 0 ? (
            <p className="text-sm text-destructive">Not ready for approval: {gate.blockers.join('; ')}</p>
          ) : (
            <ActionForm
              action={approveTask}
              hidden={{ ...hidden, head: gate.head_sha }}
              submit={`Approve ${gate.head_sha.slice(0, 12)}`}
              pendingLabel="Approving…"
            >
              <p className="text-sm text-muted-foreground">
                Approves exactly commit <span className="font-mono">{gate.head_sha.slice(0, 12)}</span>. If
                the branch changes, approval is refused and you review again.
              </p>
              <Input name="note" placeholder="Note for the pull request (optional)" />
              {blocking > 0 && (
                <label className="flex items-center gap-2 text-sm text-destructive">
                  <input type="checkbox" name="acceptBlocking" /> Accept {blocking} blocking finding(s)
                </label>
              )}
            </ActionForm>
          )}
        </Section>
      )}

      {task.stage === 'approved' && !task.pr && !busy && (
        <Section title="Open the pull request">
          <ActionForm
            action={openPullRequest}
            hidden={hidden}
            submit="Push and open pull request"
            pendingLabel="Pushing…"
          >
            <p className="text-sm text-muted-foreground">
              Pushes <span className="font-mono">{task.worktree?.branch}</span> to origin and opens a pull
              request into {task.worktree?.base_branch}. Every gate is checked again first.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="draft" defaultChecked /> Open as draft
            </label>
          </ActionForm>
        </Section>
      )}

      {canRevise && (
        <Section title="Ask for changes">
          <ActionForm
            action={reviseTask}
            hidden={hidden}
            submit="Revise"
            variant="secondary"
            pendingLabel="Starting…"
          >
            <Textarea
              name="note"
              required
              rows={2}
              placeholder="What should change? The coder sees this note, then verification and review run again."
            />
          </ActionForm>
        </Section>
      )}

      {task.stage === 'awaiting-approval' && !busy && (
        <Section title="Reject">
          <ActionForm
            action={rejectTask}
            hidden={hidden}
            submit="Reject"
            variant="destructive"
            pendingLabel="Rejecting…"
          >
            <Input name="note" required placeholder="Why is this change rejected?" />
          </ActionForm>
        </Section>
      )}

      {(task.attempts?.length ?? 0) > 0 && (
        <Section title="Model attempts">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Step</th>
                <th className="font-normal">Model</th>
                <th className="font-normal">Outcome</th>
                <th className="text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {task.attempts!.map((a, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1">{a.step}</td>
                  <td className="font-mono text-xs">
                    {a.model} ({a.effort})
                  </td>
                  <td className={a.outcome === 'failed' ? 'text-destructive' : ''}>
                    {a.outcome}
                    {a.error ? `: ${a.error}` : ''}
                  </td>
                  <td className="text-right">
                    {a.cost_usd === null ? 'unknown' : `$${a.cost_usd.toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {(task.events?.length ?? 0) > 0 && (
        <Section title="Timeline">
          <ol className="flex flex-col gap-1 text-sm">
            {task.events!.map((e, i) => (
              <li key={i} className="grid grid-cols-[10rem_1fr] gap-3">
                <time className="text-xs text-muted-foreground" dateTime={e.at}>
                  {e.at.replace('T', ' ').slice(0, 19)}
                </time>
                <span>{e.message}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}
