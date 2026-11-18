import { Bot } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { cache, type ReactNode } from 'react';
import {
  approvalBlockers,
  blockingFindings,
  executionBusy,
  taskActions,
  type TaskRecord,
} from '@factory/core';
import { DiffCodeBlock } from '@/components/diff-code-block';
import { ThinkingLoader } from '@factory/affect-ui/components/thinking-loader-clean';
import { approveTask, dismissLog, openPullRequest, rejectTask, runTask } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { AgentCheckpoints, type Checkpoint } from '@/components/agent-checkpoints';
import { AgentFindings } from '@/components/agent-findings';
import { AutoRefresh } from '@/components/auto-refresh';
import { LocalTime } from '@/components/local-time';
import { OutputBlock } from '@/components/output-block';
import { StageBadge } from '@/components/stage-badge';
import { ChatScroll, TaskChatComposer } from '@/components/task-chat';
import { Input } from '@/components/ui/input';
import {
  backgroundRun,
  isProjectName,
  isTaskId,
  readDiff,
  readTaskControls,
  type BackgroundRun,
  type Gate,
} from '@/lib/factory';
import { clip, projectLabel, stageGlyph } from '@/lib/page-title';
import { lastStepId, splitOutput, taskConversation, type AgentStep, type ChatEntry } from '@/lib/task-chat';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const SEVERITY: Record<string, string> = {
  blocking: 'text-destructive font-semibold',
  major: 'text-destructive',
  minor: 'text-foreground',
  nit: 'text-muted-foreground',
};

const TONE_DOT: Record<AgentStep['tone'], string> = {
  neutral: 'bg-muted-foreground/40',
  success: 'bg-emerald-500',
  danger: 'bg-destructive',
  attention: 'bg-amber-500',
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

function money(task: TaskRecord): string {
  const attempts = task.attempts ?? [];
  if (attempts.length === 0) return '—';
  if (attempts.some((a) => a.cost_usd === null)) return 'unknown';
  return `$${attempts.reduce((sum, a) => sum + (a.cost_usd ?? 0), 0).toFixed(2)}`;
}

/* ---------- Right panel ---------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `panel-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="border-b px-5 py-4 last:border-b-0">
      <h2 id={id} className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* ---------- Conversation ---------- */

function UserMessage({ entry }: { entry: Extract<ChatEntry, { role: 'user' }> }) {
  const lines = entry.text.split('\n');
  const long = entry.text.length > 700 || lines.length > 14;
  const text = (t: string) => <p className="text-sm leading-6 whitespace-pre-wrap">{t}</p>;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5">
        {long ? (
          <details className="group">
            <summary className="cursor-pointer list-none">
              {text(lines.slice(0, 8).join('\n'))}
              <span className="mt-1 block text-xs text-muted-foreground group-open:hidden">
                Show all {lines.length} lines
              </span>
            </summary>
            {text(lines.slice(8).join('\n'))}
          </details>
        ) : (
          text(entry.text)
        )}
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        {entry.label ? `${entry.label} · ` : ''}
        <LocalTime iso={entry.at} format="date-time" />
      </p>
    </div>
  );
}

function AgentMessage({ at, children }: { at?: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
        <Bot className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs text-muted-foreground">
          Factory
          {at && (
            <>
              {' '}
              · <LocalTime iso={at} format="date-time" />
            </>
          )}
        </p>
        {children}
      </div>
    </div>
  );
}

function StepList({ steps, extra }: { steps: AgentStep[]; extra: (step: AgentStep) => ReactNode }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step) => (
        <li key={step.id}>
          <div className="flex items-baseline gap-2.5 text-sm">
            <span
              className={cn('size-1.5 shrink-0 translate-y-[-2px] rounded-full', TONE_DOT[step.tone])}
              aria-hidden
            />
            <span
              className={cn(
                'min-w-0 flex-1 break-words',
                step.tone === 'danger' && 'text-destructive',
                step.tone === 'attention' && 'font-medium',
              )}
            >
              {step.href ? (
                <a href={step.href} target="_blank" rel="noreferrer" className="font-medium underline">
                  Pull request opened
                </a>
              ) : (
                step.text
              )}
            </span>
            <LocalTime iso={step.at} className="shrink-0 text-xs tabular-nums text-muted-foreground" />
          </div>
          {step.output && (
            <div className="ml-4">
              <OutputBlock output={step.output} tone={step.tone === 'danger' ? 'danger' : undefined} />
            </div>
          )}
          {extra(step)}
        </li>
      ))}
    </ol>
  );
}

function ReviewCard({ review }: { review: NonNullable<TaskRecord['review']> }) {
  return (
    <div className="mt-2 mb-1 ml-4 rounded-xl border bg-background p-3 text-sm shadow-xs">
      <p>
        <span className="font-medium">Review: {review.verdict}</span> — {review.summary}
      </p>
      {review.findings.length > 0 && (
        <AgentFindings
          title="Review findings"
          agents={[{ id: 'reviewer', name: 'Reviewer', done: 1, total: 1, status: 'done' }]}
          rows={review.findings.length}
          findings={review.findings.map((finding, index) => ({
            id: String(index),
            agentId: 'reviewer',
            title: `${finding.severity}: ${finding.message}`,
            severity:
              finding.severity === 'blocking'
                ? 'critical'
                : finding.severity === 'major'
                  ? 'warning'
                  : 'note',
            ...(finding.file ? { location: finding.file } : {}),
            at: Date.parse(review.at) || 0,
          }))}
        />
      )}
      {review.findings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {review.findings.map((f, i) => (
            <li key={i}>
              <span className={cn('text-xs uppercase', SEVERITY[f.severity])}>{f.severity}</span>{' '}
              {f.file && <span className="font-mono text-xs">{f.file}: </span>}
              {f.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RunningTurn({ run }: { run: BackgroundRun }) {
  return (
    <AgentMessage>
      <div className="affect-ui-theme">
        <ThinkingLoader phases={[run.label ?? 'Working']} variant="plain" size="sm" />
      </div>
      {run.logTail && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Live output</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
            {run.logTail}
          </pre>
        </details>
      )}
    </AgentMessage>
  );
}

/* ---------- Page ---------- */

/** One backend read per request, shared by the tab title and the page. */
const loadControls = cache((project: string, id: string) => readTaskControls(project, id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string; id: string }>;
}): Promise<Metadata> {
  const { project, id } = await params;
  if (!isProjectName(project) || !isTaskId(id)) return { title: 'Task' };
  const [shown, label] = await Promise.all([loadControls(project, id), projectLabel(project)]);
  if (!shown.ok) return { title: `Task · ${label}` };
  const task = shown.value.task;
  return { title: `${stageGlyph(task.stage)} ${clip(task.name ?? task.prompt)} · ${label}` };
}

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; id: string }>;
  searchParams?: Promise<{ start?: string }>;
}) {
  const startFailed = (await searchParams)?.start === 'failed';
  const { project, id } = await params;
  if (!isProjectName(project) || !isTaskId(id)) notFound();
  const shown = await loadControls(project, id);
  if (!shown.ok) {
    return (
      <div className="px-6 py-6">
        <p className="text-destructive">Task unavailable: {shown.error}</p>
      </div>
    );
  }
  const controls = shown.value;
  const task = controls.task;
  const gate: Gate | undefined =
    controls.head_sha && controls.diff_stat !== undefined
      ? {
          task,
          head_sha: controls.head_sha,
          diff_stat: controls.diff_stat,
          blockers: approvalBlockers(task, controls.head_sha),
        }
      : undefined;
  const gateError = controls.gate_error;
  const diffResult = gate ? await readDiff(project, id) : undefined;
  const diff = diffResult?.ok ? diffResult.value : undefined;
  const run = await backgroundRun(project, id);
  // A failed observation must never unlock a command or pretend a worker is alive.
  const phase =
    controls.execution === 'unavailable' || run.phase === 'unavailable'
      ? 'unavailable'
      : executionBusy(controls.execution)
        ? controls.execution
        : (run.phase ?? controls.execution);
  const busy = executionBusy(phase);
  const actions = taskActions(task, phase, controls.head_sha);
  const allowed = (action: string) => actions.some((a) => a.action === action && a.allowed);
  const hidden = { project, id };
  const blocking = blockingFindings(task);
  const canRevise = allowed('revise');
  const canRun = allowed('run') && !canRevise && task.stage !== 'blocked';
  const interrupted =
    phase === 'interrupted' ||
    (!busy && phase !== 'unavailable' && (task.stage === 'coding' || task.stage === 'reviewing'));

  const conversation = taskConversation(task);
  const reviewAt = lastStepId(conversation, 'stage:awaiting-approval');
  const blockedAt = lastStepId(conversation, 'stage:blocked') ?? lastStepId(conversation, 'verdict');
  const blockers = task.verdict?.blockers ?? [];
  const stepExtra = (step: AgentStep) => {
    if (step.id === reviewAt && task.review) return <ReviewCard review={task.review} />;
    if (step.id === blockedAt && blockers.length > 0)
      return (
        <ul className="mt-2 mb-1 ml-4 list-disc rounded-xl border bg-background py-3 pr-3 pl-8 text-sm shadow-xs">
          {blockers.map((b, i) => (
            <li key={i}>
              <span className="font-medium">{b.kind}:</span> {b.question}
            </li>
          ))}
        </ul>
      );
    return null;
  };

  const composer = canRevise ? (
    <TaskChatComposer mode="revise" project={project} id={id} />
  ) : (
    <TaskChatComposer
      mode="locked"
      reason={
        phase === 'unavailable'
          ? 'Execution status is unavailable. Refresh before acting.'
          : busy
            ? 'The factory is working. You can ask for changes when this run finishes.'
            : task.pr
              ? 'The pull request is open. This task is finished.'
              : task.stage === 'blocked'
                ? 'Blocked before any code. Start a new task that answers the questions above.'
                : canRun
                  ? 'Run the task to start the conversation.'
                  : `Nothing to send while the task is ${task.stage}.`
      }
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col max-lg:overflow-y-auto lg:grid lg:grid-cols-[2fr_1fr]">
      {busy && <AutoRefresh />}

      <section aria-label="Conversation" className="flex min-h-0 flex-col max-lg:h-[85dvh] max-lg:shrink-0">
        <header className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={task.name ?? task.prompt}>
            {title(task.name ?? task.prompt)}
          </h1>
          <StageBadge stage={task.stage} />
        </header>

        <ChatScroll>
          {startFailed && (
            <p role="status" className="text-sm text-destructive">
              Task saved, but the run could not start. Use Run task to retry without creating another task.
            </p>
          )}
          {conversation.map((entry) =>
            entry.role === 'user' ? (
              <UserMessage key={entry.id} entry={entry} />
            ) : (
              <AgentMessage key={entry.id} at={entry.at}>
                <StepList steps={entry.steps} extra={stepExtra} />
              </AgentMessage>
            ),
          )}

          {busy && (
            <RunningTurn
              run={{
                ...run,
                label:
                  phase === 'queued'
                    ? 'Queued for the worker'
                    : phase === 'finalizing'
                      ? 'Saving evidence and releasing the task'
                      : run.label,
              }}
            />
          )}
          {phase === 'unavailable' && (
            <p role="alert" className="text-sm text-destructive">
              Execution status is unavailable. Refresh before acting.
            </p>
          )}
          {interrupted && (
            <p role="status" className="text-sm text-destructive">
              This run has no live owner. Inspect the last output and command lock before explicitly running
              recovery. It will not restart automatically.
            </p>
          )}

          {canRun && (
            <AgentMessage>
              <ActionForm action={runTask} hidden={hidden} submit="Run task" pendingLabel="Starting…">
                <p className="text-sm">
                  {task.worktree
                    ? 'Explicitly reruns coding, verification and review in the existing worktree, then stops for approval. Inspect interrupted work before proceeding. Nothing is pushed.'
                    : "Ready when you are. I'll classify the task, code it in a new worktree, verify and review it, then stop for your approval. Nothing is pushed."}
                </p>
              </ActionForm>
            </AgentMessage>
          )}

          {phase !== 'unavailable' && !busy && task.stage === 'awaiting-approval' && (
            <AgentMessage>
              <p className="text-sm">
                Waiting for your decision. Approve or reject in the panel, or reply below to ask for changes.
              </p>
            </AgentMessage>
          )}

          {!run.running && run.logTail && (
            <AgentMessage>
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">Last run output</summary>
                <OutputBlock output={run.logTail} label="Run output" />
              </details>
              <form action={dismissLog} className="mt-1">
                <input type="hidden" name="project" value={project} />
                <input type="hidden" name="id" value={id} />
                <button className="text-xs text-muted-foreground hover:underline">Dismiss</button>
              </form>
            </AgentMessage>
          )}
        </ChatScroll>

        {composer}
      </section>

      <aside
        aria-label="Task details"
        className="min-h-0 border-t bg-muted/30 lg:overflow-y-auto lg:border-t-0 lg:border-l"
      >
        <Section title="Task">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Stage</dt>
            <dd>
              <StageBadge stage={task.stage} />
            </dd>
            <dt className="text-muted-foreground">Cost</dt>
            <dd>{money(task)}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{task.created_at ? <LocalTime iso={task.created_at} format="date-time" /> : '—'}</dd>
            <dt className="text-muted-foreground">ID</dt>
            <dd className="truncate font-mono text-xs leading-5" title={task.id}>
              {task.id}
            </dd>
          </dl>
        </Section>

        <Section title="Stage timeline">
          <AgentCheckpoints
            title="Stages"
            mode="timeline"
            checkpoints={(task.events ?? [])
              .filter((event) => event.kind.startsWith('stage:'))
              .map((event, index, events): Checkpoint => {
                const start = Date.parse(events[0]!.at);
                const at = Date.parse(event.at);
                return {
                  id: `stage-${index}`,
                  ...(index ? { parent: `stage-${index - 1}` } : {}),
                  title: splitOutput(event.message).text || event.kind.slice(6),
                  status: /failed|blocked|rejected/.test(event.kind) ? 'failed' : 'done',
                  ...(Number.isFinite(start) && Number.isFinite(at) ? { at: Math.max(0, at - start) } : {}),
                };
              })}
          />
        </Section>

        {task.pr && (
          <Section title="Pull request">
            <a
              href={task.pr.url}
              className="text-sm font-medium break-all underline"
              target="_blank"
              rel="noreferrer"
            >
              {task.pr.url}
            </a>
            <p className="mt-1 text-xs text-muted-foreground">
              Opened from {task.pr.head_sha.slice(0, 12)} on {task.pr.branch}
            </p>
          </Section>
        )}

        {gate && task.stage === 'awaiting-approval' && !busy && phase !== 'unavailable' && (
          <Section title="Your decision">
            {gate.blockers.length > 0 ? (
              <p className="text-sm text-destructive">Not ready for approval: {gate.blockers.join('; ')}</p>
            ) : (
              <div className="flex flex-col gap-4">
                <ActionForm
                  action={approveTask}
                  hidden={{ ...hidden, head: gate.head_sha }}
                  submit={`Approve ${gate.head_sha.slice(0, 12)}`}
                  pendingLabel="Approving…"
                >
                  <p className="text-sm text-muted-foreground">
                    Approves exactly this commit. If the branch changes, approval is refused and you review
                    again.
                  </p>
                  <Input name="note" placeholder="Note for the pull request (optional)" />
                  {blocking > 0 && (
                    <label className="flex items-center gap-2 text-sm text-destructive">
                      <input type="checkbox" name="acceptBlocking" /> Accept {blocking} blocking finding(s)
                    </label>
                  )}
                </ActionForm>
                <ActionForm
                  action={rejectTask}
                  hidden={hidden}
                  submit="Reject"
                  variant="destructive"
                  pendingLabel="Rejecting…"
                >
                  <Input name="note" required placeholder="Why is this change rejected?" />
                </ActionForm>
              </div>
            )}
          </Section>
        )}

        {task.stage === 'approved' && !allowed('open-pr') && (
          <Section title="Pull request gate">
            <p className="text-sm text-destructive">
              {actions
                .find((a) => a.action === 'open-pr')
                ?.blockers.map((b) => b.message)
                .join('; ')}
            </p>
          </Section>
        )}
        {allowed('open-pr') && (
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

        {task.verdict && (
          <Section title="Classifier">
            <p className="text-sm">
              Kind <b>{task.verdict.kind}</b> · size <b>{task.verdict.loe}</b> · {task.verdict.readiness}
            </p>
          </Section>
        )}

        {gateError && (
          <Section title="Gate">
            <p className="text-sm text-destructive">Gate unavailable: {gateError}</p>
          </Section>
        )}

        {gate && (
          <Section title="Change">
            <p className="text-sm break-all">
              <span className="font-mono text-xs">{task.worktree?.branch}</span> →{' '}
              {task.worktree?.base_branch}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Head <span className="font-mono">{gate.head_sha.slice(0, 12)}</span>
            </p>
            <pre className="mt-3 overflow-auto rounded-lg bg-background p-3 text-xs">
              {gate.diff_stat || 'No changes yet.'}
            </pre>
            {diffResult && !diffResult.ok && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                Could not load the diff: {diffResult.error}
              </p>
            )}
            {diff && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium">Full diff</summary>
                <div className="mt-2">
                  <DiffCodeBlock code={diff} filename="Changes.diff" showLineNumbers maxHeight="32rem" />
                </div>
              </details>
            )}
            <p className="mt-2 truncate text-xs text-muted-foreground" title={task.worktree?.path}>
              Worktree: <span className="font-mono">{task.worktree?.path}</span>
            </p>
          </Section>
        )}

        {task.verification && (
          <Section title="Verification">
            <p className={cn('text-sm', !task.verification.passed && 'text-destructive')}>
              {task.verification.passed ? 'Passed' : 'Failed'} at{' '}
              <span className="font-mono">{task.verification.head_sha.slice(0, 12)}</span>
            </p>
            {task.verification.runtime && (
              <p
                className={cn(
                  'mt-1 text-sm',
                  task.verification.runtime === 'no' && 'text-destructive',
                  task.verification.runtime !== 'yes' &&
                    task.verification.runtime !== 'no' &&
                    'text-amber-700 dark:text-amber-400',
                )}
              >
                Running app (Reticle):{' '}
                {task.verification.runtime === 'yes'
                  ? 'no faults found'
                  : task.verification.runtime === 'no'
                    ? 'faults found'
                    : 'could not decide. Check the running app before you approve.'}
              </p>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-sm">Output</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-background p-3 text-xs whitespace-pre-wrap">
                {task.verification.output_tail}
              </pre>
            </details>
          </Section>
        )}

        {gate && !task.pr && (
          <Section title="Pull request draft">
            {task.pr_draft && task.pr_draft.head_sha === gate.head_sha ? (
              <>
                <p className="text-sm font-medium">{task.pr_draft.title}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm">Body</summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-background p-3 text-xs whitespace-pre-wrap">
                    {task.pr_draft.body}
                  </pre>
                </details>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No draft for this commit. Run <span className="font-mono">factory task draft-pr</span> to
                write one.
              </p>
            )}
          </Section>
        )}

        {(task.attempts?.length ?? 0) > 0 && (
          <Section title="Model attempts">
            <ul className="flex flex-col gap-1.5 text-sm">
              {task.attempts!.map((a, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="w-20 shrink-0">{a.step}</span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate font-mono text-xs',
                      a.outcome === 'failed' && 'text-destructive',
                    )}
                    title={a.error ? `${a.outcome}: ${a.error}` : a.outcome}
                  >
                    {a.model} ({a.effort}){a.outcome === 'failed' ? ' · failed' : ''}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {a.cost_usd === null ? '?' : `$${a.cost_usd.toFixed(2)}`}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Project">
          <Link href={`/projects/${project}/tasks/${id}/trace`} className="text-sm underline">
            View trace
          </Link>
          <Link href={`/projects/${project}/tasks`} className="text-sm hover:underline">
            All tasks in {project}
          </Link>
        </Section>
      </aside>
    </div>
  );
}
