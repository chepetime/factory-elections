import { Bot, ChevronDown, ChevronRight, CircleAlert, CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode } from 'react';
import {
  approvalBlockers,
  blockingFindings,
  executionBusy,
  runWorking,
  taskActions,
  type TaskRecord,
  stageLabel,
} from '@factory/core';
import { DiffCodeBlock } from '@/components/diff-code-block';
import {
  approveAndOpenPullRequest,
  approveTask,
  confirmCleanup,
  dismissLog,
  openPullRequest,
  rejectTask,
  runTask,
  checkTask,
} from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { type Checkpoint } from '@/components/agent-checkpoints';
import { StageTimeline } from '@/components/stage-timeline';
import { LocalTime } from '@/components/local-time';
import { LiveRun } from '@/components/live-run';
import { Markdown } from '@/components/markdown';
import { OutputBlock } from '@/components/output-block';
import { TaskChatComposer } from '@/components/task-chat';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentAvatar } from '@/components/agent-avatar';
import { listAgents } from '@/lib/agents';
import { RunWatch } from '@/components/run-watch';
import { backgroundRun, readDiff, readTaskControls, type Gate } from '@/lib/factory';
import { pageVersion, taskPhase } from '@/lib/live-run';
import { lastStepId, stageTimeline, taskConversation, type AgentStep, type ChatEntry } from '@/lib/task-chat';
import { cn } from '@/lib/utils';

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

export function money(task: TaskRecord): string {
  const attempts = task.attempts ?? [];
  if (attempts.length === 0) return '—';
  if (attempts.some((a) => a.cost_usd === null)) return 'unknown';
  return `$${attempts.reduce((sum, a) => sum + (a.cost_usd ?? 0), 0).toFixed(2)}`;
}

export function Section({
  title,
  aside,
  flush,
  children,
}: {
  title: string;
  /** A short value at the right of the title, e.g. a total. */
  aside?: ReactNode;
  /** No side padding, for content that has its own (the stage timeline). */
  flush?: boolean;
  children: ReactNode;
}) {
  const id = `panel-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="py-3">
      <details open className="group/section">
        <summary className="mx-5 flex cursor-pointer list-none items-center gap-3 rounded-md py-1 select-none focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <h2 id={id} className="flex items-center gap-1 text-sm font-medium">
            {title}
            <ChevronDown
              aria-hidden
              className="size-3.5 text-muted-foreground transition-transform duration-150 ease-out -rotate-90 group-open/section:rotate-0 motion-reduce:transition-none"
            />
          </h2>
          {aside && <span className="ml-auto text-sm text-muted-foreground">{aside}</span>}
        </summary>
        <div className={cn('pt-3 pb-2', flush ? 'px-0' : 'px-5')}>{children}</div>
      </details>
    </section>
  );
}

/** Label and value rows with one label column, so every panel section lines up. */
export function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-sm">{children}</dl>
  );
}
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** A closed-by-default section with a turning chevron. */
export function Disclosure({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={cn('group/disclosure', className)}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform duration-150 ease-out group-open/disclosure:rotate-90 motion-reduce:transition-none"
        />
        {label}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/** `git diff --stat` as rows: file, changed lines and a small added/removed bar. */
function DiffStat({ stat }: { stat: string }) {
  const lines = stat.split('\n').filter((line) => line.trim());
  const files = lines.flatMap((line) => {
    const match = /^\s*(.+?)\s+\|\s+(\d+|Bin.*?)\s*([+-]*)\s*$/.exec(line);
    if (!match) return [];
    const marks = match[3] ?? '';
    const plus = [...marks].filter((c) => c === '+').length;
    return [{ file: match[1]!, count: match[2]!, plus, minus: marks.length - plus }];
  });
  const summary = lines.find((line) => /files? changed/.test(line))?.trim();
  if (!files.length)
    return (
      <p className="mt-3 text-sm text-muted-foreground">{summary ?? (stat.trim() || 'No changes yet.')}</p>
    );
  return (
    <div className="mt-3 rounded-lg border bg-background">
      <ul className="divide-y text-xs">
        {files.map((f) => {
          const total = f.plus + f.minus || 1;
          return (
            <li key={f.file} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono" title={f.file}>
                {f.file}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{f.count}</span>
              <span aria-hidden className="flex h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
                <span className="bg-emerald-500" style={{ width: `${(f.plus / total) * 100}%` }} />
                <span className="bg-red-500" style={{ width: `${(f.minus / total) * 100}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
      {summary && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{summary}</p>}
    </div>
  );
}

/* ---------- Conversation ---------- */

export function UserMessage({ entry }: { entry: Extract<ChatEntry, { role: 'user' }> }) {
  const lines = entry.text.split('\n');
  const long = entry.text.length > 700 || lines.length > 14;
  const text = (t: string) => <p className="text-sm leading-6 whitespace-pre-wrap">{t}</p>;
  return (
    <div className="group/msg flex flex-col items-end gap-1">
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
      <p className={cn('px-1 text-xs text-muted-foreground', SHOW_ON_HOVER.msg)}>
        {entry.label ? `${entry.label} · ` : ''}
        <LocalTime iso={entry.at} format="date-time" />
      </p>
    </div>
  );
}

/** Chat times stay hidden until you hover or focus their message (always shown on touch screens). */
const SHOW_ON_HOVER = {
  msg: 'opacity-0 transition-opacity [@media(hover:none)]:opacity-100 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100',
  step: 'opacity-0 transition-opacity [@media(hover:none)]:opacity-100 group-hover/step:opacity-100 group-focus-within/step:opacity-100',
};

const FINDING_ORDER = ['blocking', 'major', 'minor', 'nit'] as const;

/** The end of a successful run: what changed, what was checked, what the reviewer found. */
/** A card on the ticket for something only you can do now. */
function NeedsYou({
  title,
  tone = 'action',
  children,
}: {
  title: string;
  tone?: 'action' | 'danger';
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'rounded-xl border p-4 text-sm',
        tone === 'danger' ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      <h2
        className={cn(
          'mb-2 flex items-center gap-2 font-semibold',
          tone === 'danger' ? 'text-destructive' : 'text-amber-800 dark:text-amber-300',
        )}
      >
        <CircleAlert className="size-4" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

function ReadyCard({ task, diffStat }: { task: TaskRecord; diffStat?: string }) {
  const verification = task.verification;
  const review = task.review;
  const counts = FINDING_ORDER.map(
    (severity) => [severity, review?.findings.filter((f) => f.severity === severity).length ?? 0] as const,
  ).filter(([, n]) => n > 0);
  const notRun = verification?.not_run_locally ?? [];
  const summaryLine = diffStat?.trim().split('\n').at(-1)?.trim();
  return (
    <section
      aria-label="Ready for your approval"
      className="rounded-xl border border-emerald-600/40 bg-emerald-500/5 p-4 text-sm"
    >
      <h2 className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
        <CircleCheck className="size-4" aria-hidden />
        Ready for your approval
      </h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {summaryLine && (
          <>
            <dt className="text-muted-foreground">Change</dt>
            <dd>{summaryLine}</dd>
          </>
        )}
        {verification && (
          <>
            <dt className="text-muted-foreground">Checks</dt>
            <dd>
              Passed
              {notRun.length > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {' '}
                  · not run locally: {notRun.join(', ')}. CI must pass before you merge.
                </span>
              )}
            </dd>
          </>
        )}
        {review && (
          <>
            <dt className="text-muted-foreground">Review</dt>
            <dd>
              {review.verdict === 'approve' ? 'Approved' : 'Changes requested'}
              {counts.length > 0
                ? ` · ${counts.map(([severity, n]) => `${n} ${severity}`).join(', ')}`
                : ' · no findings'}
            </dd>
          </>
        )}
        {task.pr_draft && (
          <>
            <dt className="text-muted-foreground">Pull request</dt>
            <dd>{task.pr_draft.title}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Cost</dt>
        <dd>{money(task)}</dd>
      </dl>
      {review && review.findings.length > 0 && (
        <ul aria-label="Review findings" className="mt-3 flex flex-col gap-2 border-t pt-3">
          {[...review.findings]
            .sort((a, b) => FINDING_ORDER.indexOf(a.severity) - FINDING_ORDER.indexOf(b.severity))
            .map((f, i) => (
              <li key={i}>
                <span className={cn('text-xs uppercase', SEVERITY[f.severity])}>{f.severity}</span>{' '}
                {f.file && <span className="font-mono text-xs">{f.file}: </span>}
                {f.message}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

/** What you can do next with a change that is ready: the same gates as the decision panel. */
function DecisionOptions({
  hidden,
  head,
  blockers,
  blocking,
  branch,
  askHref,
}: {
  hidden: Record<string, string>;
  head: string;
  branch?: string;
  blockers: string[];
  blocking: number;
  /** Where "Ask for changes" goes when the chat box is not on the page. */
  askHref?: string;
}) {
  if (blockers.length > 0)
    return <p className="mt-3 text-sm text-destructive">Not ready for approval: {blockers.join('; ')}</p>;
  const accept = blocking > 0 && (
    <label className="flex items-center gap-2 text-sm text-destructive">
      <input type="checkbox" name="acceptBlocking" /> Accept {blocking} blocking finding(s)
    </label>
  );
  return (
    <div aria-label="Your options" role="group" className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <ActionForm
          action={approveAndOpenPullRequest}
          hidden={{ ...hidden, head }}
          submit="Approve and open draft PR"
          pendingLabel="Approving and pushing…"
        >
          {accept}
        </ActionForm>
        <ActionForm
          action={approveTask}
          hidden={{ ...hidden, head }}
          submit="Approve only"
          variant="outline"
          pendingLabel="Approving…"
        >
          {accept}
        </ActionForm>
        {askHref ? (
          <Link href={askHref} className={buttonVariants({ variant: 'outline' })}>
            Ask for changes
          </Link>
        ) : (
          <label
            htmlFor="chat-input"
            className={cn(buttonVariants({ variant: 'outline' }), 'cursor-pointer')}
          >
            Ask for changes
          </label>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Reject the change…
        </summary>
        <div className="mt-2 max-w-md">
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
      </details>
      <p className="text-xs text-muted-foreground">
        Approval covers exactly commit <span className="font-mono">{head.slice(0, 12)}</span>. The draft PR
        pushes {branch ? <span className="font-mono">{branch}</span> : 'the branch'} to origin. Nothing
        merges.
      </p>
    </div>
  );
}

/** Who speaks in a run: the workspace agent for an agent run, else Factory's pipeline. */
export type RunAuthor = { name: string; avatar: string };

export function AgentMessage({
  at,
  author,
  children,
}: {
  at?: string;
  author?: RunAuthor;
  children: ReactNode;
}) {
  return (
    <div className="group/msg flex gap-3">
      {author ? (
        <AgentAvatar agent={author} decorative className="mt-0.5 size-7 text-sm" />
      ) : (
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
          <Bot className="size-4" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs text-muted-foreground">
          {author?.name ?? 'Factory'}
          {at && (
            <span className={SHOW_ON_HOVER.msg}>
              {' '}
              · <LocalTime iso={at} format="date-time" />
            </span>
          )}
        </p>
        {children}
      </div>
    </div>
  );
}

function StepList({
  steps,
  extra,
  openFailure,
}: {
  steps: AgentStep[];
  extra: (step: AgentStep) => ReactNode;
  /** The failure that still stands. Error output of earlier failures stays folded. */
  openFailure?: string;
}) {
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step) => (
        <li key={step.id} className="group/step">
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
            <LocalTime
              iso={step.at}
              className={cn('shrink-0 text-xs tabular-nums text-muted-foreground', SHOW_ON_HOVER.step)}
            />
          </div>
          {step.reply && (
            <div
              className={cn(
                'mt-2 ml-4 rounded-lg border bg-card px-3 py-2 shadow-xs',
                step.tone === 'danger' && 'border-l-[3px] border-l-destructive',
              )}
            >
              <p className="mb-1 text-xs text-muted-foreground">Coder&apos;s last message</p>
              <Markdown text={step.reply} />
            </div>
          )}
          {step.output &&
            (step.tone === 'danger' && step.id !== openFailure ? (
              <details className="ml-4">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Error output (a later run went past this failure)
                </summary>
                <OutputBlock output={step.output} tone="danger" />
              </details>
            ) : (
              <div className="ml-4">
                <OutputBlock output={step.output} tone={step.tone === 'danger' ? 'danger' : undefined} />
              </div>
            ))}
          {extra(step)}
        </li>
      ))}
    </ol>
  );
}

function ReviewCard({
  review,
  findings = true,
}: {
  review: NonNullable<TaskRecord['review']>;
  /** Off when the ready card below lists the findings. */
  findings?: boolean;
}) {
  return (
    <div className="mt-2 mb-1 ml-4 rounded-xl border bg-background p-3 text-sm shadow-xs">
      <p>
        <span className="font-medium">Review: {review.verdict}.</span> {review.summary}
      </p>
      {findings && review.findings.length > 0 && (
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

/* ---------- Page ---------- */

export type RunParts = {
  task: TaskRecord;
  /**
   * What the run needs from you now, for the ticket itself: the decision at the gate, opening the PR,
   * or the agent's question. Undefined while nothing waits on you.
   */
  attention: ReactNode;
  /** The run's conversation and its live and decision cards, for the activity feed. */
  activity: ReactNode;
  /** Revise while the run takes notes, Stop while it works; otherwise `fallback`. */
  composer: ReactNode;
  /** The run's detail sections for the side panel. */
  sections: ReactNode;
};

/**
 * Loads one factory run and renders its parts. `fallback` replaces the locked composer, so a board
 * task can take comments while its run takes no notes.
 */
export async function renderRun(
  project: string,
  id: string,
  {
    startFailed = false,
    fallback,
    runHref,
  }: { startFailed?: boolean; fallback?: ReactNode; runHref?: string } = {},
): Promise<{ ok: true; value: RunParts } | { ok: false; error: string }> {
  const shown = await readTaskControls(project, id);
  if (!shown.ok) return { ok: false, error: shown.error };
  const controls = shown.value;
  const task = controls.task;
  const roster = task.workflow === 'agent' && task.agent ? await listAgents() : undefined;
  const found = roster?.ok ? roster.value.find((a) => a.id === task.agent) : undefined;
  const author: RunAuthor | undefined = found
    ? { name: found.name, avatar: found.avatar }
    : task.workflow === 'agent' && task.agent
      ? { name: task.agent, avatar: '🤖' }
      : undefined;
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
  const phase = taskPhase(controls.execution, run);
  const busy = executionBusy(phase);
  const version = pageVersion(task, phase, run.label);
  // The cleanup is part of the policy: an unconfirmed uncertain one blocks run and revise.
  const actions = taskActions(task, phase, controls.head_sha, run.cleanup);
  const allowed = (action: string) => actions.some((a) => a.action === action && a.allowed);
  const hidden = { project, id };
  const blocking = blockingFindings(task);
  const canRevise = allowed('revise');
  const canRun = allowed('run') && !canRevise && task.stage !== 'blocked';
  const interrupted = phase === 'interrupted' || (!busy && phase !== 'unavailable' && runWorking(task.stage));

  const runLabel =
    phase === 'queued'
      ? 'Queued for the worker'
      : phase === 'finalizing'
        ? 'Saving evidence and releasing the task'
        : run.label;
  // Stop is offered while the run waits or works; finalizing only saves evidence.
  const canStop = phase === 'queued' || phase === 'running';

  const showReady = phase !== 'unavailable' && !busy && task.stage === 'awaiting-approval';
  const conversation = taskConversation(task);
  // Only a failure the task still sits in keeps its error output open.
  const lastDanger = conversation
    .flatMap((entry) => (entry.role === 'user' ? [] : entry.steps))
    .filter((step) => step.tone === 'danger')
    .at(-1)?.id;
  const openFailure = ['failed', 'verification-failed', 'blocked'].includes(task.stage)
    ? lastDanger
    : undefined;
  const reviewAt = lastStepId(conversation, 'stage:awaiting-approval');
  const blockedAt = lastStepId(conversation, 'stage:blocked') ?? lastStepId(conversation, 'verdict');
  const blockers = task.verdict?.blockers ?? [];
  const stepExtra = (step: AgentStep) => {
    if (step.id === reviewAt && task.review) return <ReviewCard review={task.review} findings={!showReady} />;
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
  ) : canStop ? (
    <TaskChatComposer
      mode="running"
      project={project}
      id={id}
      reason="The factory is working. Stop the run, or ask for changes when it finishes."
    />
  ) : (
    (fallback ?? (
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
    ))
  );

  const activity = (
    <>
      {startFailed && (
        <p role="status" className="text-sm text-destructive">
          Task saved, but the run could not start. Use Run task to retry without creating another task.
        </p>
      )}
      {conversation.map((entry) =>
        entry.role === 'user' ? (
          <UserMessage key={entry.id} entry={entry} />
        ) : (
          <AgentMessage author={author} key={entry.id} at={entry.at}>
            <StepList steps={entry.steps} extra={stepExtra} openFailure={openFailure} />
          </AgentMessage>
        ),
      )}

      {busy && (
        <AgentMessage author={author}>
          <LiveRun
            key={version}
            project={project}
            id={id}
            label={runLabel}
            version={version}
            initial={{ logTail: run.logTail, activity: run.activity }}
            renderedAt={Date.now()}
          />
        </AgentMessage>
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
      {!busy && run.cleanup?.status === 'uncertain' && !run.cleanup.confirmed_at && (
        <AgentMessage author={author}>
          <ActionForm
            action={confirmCleanup}
            hidden={hidden}
            submit="Nothing is running; allow new runs"
            pendingLabel="Confirming…"
          >
            <p className="text-sm">
              The last run may have left processes running
              {run.cleanup.reasons?.length ? `: ${run.cleanup.reasons.join('; ')}` : ''}. A new run in the
              same worktree would race them, so it waits. Check for them (for example,{' '}
              <code className="font-mono text-xs">ps -ef | grep {task.worktree?.path ?? 'the worktree'}</code>
              ), stop any you find, then confirm.
            </p>
          </ActionForm>
        </AgentMessage>
      )}

      {canRun && (
        <AgentMessage author={author}>
          <ActionForm
            action={runTask}
            hidden={hidden}
            submit={task.workflow === 'agent' ? 'Start the agent' : 'Run task'}
            pendingLabel="Starting…"
          >
            <p className="text-sm">
              {task.workflow === 'agent'
                ? task.worktree
                  ? 'Continues the agent session in the existing worktree, then runs the checks and stops for your approval. Nothing is pushed.'
                  : 'The agent has not started. It works the task in one session in a new worktree, then the checks run and it stops for your approval. Nothing is pushed.'
                : task.worktree
                  ? 'Explicitly reruns coding, verification and review in the existing worktree, then stops for approval. Inspect interrupted work before proceeding. Nothing is pushed.'
                  : "Ready when you are. I'll classify the task, code it in a new worktree, verify and review it, then stop for your approval. Nothing is pushed."}
            </p>
          </ActionForm>
        </AgentMessage>
      )}

      {showReady && (
        <AgentMessage author={author}>
          <ReadyCard task={task} diffStat={controls.diff_stat} />
          {gate && (
            <DecisionOptions
              hidden={hidden}
              head={gate.head_sha}
              blockers={gate.blockers}
              blocking={blocking}
              branch={task.worktree?.branch}
            />
          )}
        </AgentMessage>
      )}

      {!run.running && run.logTail && (
        <AgentMessage author={author}>
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
    </>
  );

  const waitingMessage = [...(task.events ?? [])].reverse().find((e) => e.kind.startsWith('stage:'))?.message;
  const who = author?.name ?? 'The factory';
  const attention =
    busy || phase === 'unavailable' ? undefined : showReady && gate ? (
      <div className="flex flex-col gap-1">
        <ReadyCard task={task} diffStat={controls.diff_stat} />
        <DecisionOptions
          hidden={hidden}
          head={gate.head_sha}
          blockers={gate.blockers}
          blocking={blocking}
          branch={task.worktree?.branch}
          {...(runHref ? { askHref: runHref } : {})}
        />
      </div>
    ) : allowed('open-pr') ? (
      <NeedsYou title="Approved: open the pull request">
        <ActionForm
          action={openPullRequest}
          hidden={hidden}
          submit={task.pr ? 'Push and update the pull request' : 'Push and open pull request'}
          pendingLabel="Pushing…"
        >
          <p className="text-sm text-muted-foreground">
            Pushes <span className="font-mono">{task.worktree?.branch}</span> to origin and{' '}
            {task.pr
              ? 'updates the open pull request'
              : `opens a pull request into ${task.worktree?.base_branch}`}
            . Every gate is checked again first.
          </p>
          {!task.pr && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="draft" defaultChecked /> Open as draft
            </label>
          )}
        </ActionForm>
      </NeedsYou>
    ) : task.stage === 'approved' ? (
      <NeedsYou title="Approved, but the pull request cannot open yet" tone="danger">
        <p className="text-sm">
          {actions
            .find((a) => a.action === 'open-pr')
            ?.blockers.map((b) => b.message)
            .join('; ')}
        </p>
      </NeedsYou>
    ) : ['blocked', 'failed', 'verification-failed'].includes(task.stage) ? (
      <NeedsYou
        title={task.stage === 'blocked' ? `${who} needs you` : `${who} stopped: ${stageLabel(task.stage)}`}
        tone={task.stage === 'blocked' ? 'action' : 'danger'}
      >
        {waitingMessage && <p className="text-sm whitespace-pre-wrap">{waitingMessage}</p>}
        {task.workflow === 'agent' && actions.find((a) => a.action === 'check')?.allowed && (
          <ActionForm
            action={checkTask}
            hidden={hidden}
            submit="Run the checks again"
            pendingLabel="Starting…"
          >
            <p className="text-xs text-muted-foreground">
              Runs the factory&apos;s checks on the current commit, outside the agent sandbox, with no agent
              turn. A pass puts the change at your approval.
            </p>
          </ActionForm>
        )}
        {task.workflow === 'agent' && task.agent && /\bbudget\b/i.test(waitingMessage ?? '') && (
          <Link
            href={`/agents/${encodeURIComponent(task.agent)}?tab=settings&section=general`}
            className="mt-2 inline-flex h-8 items-center rounded-lg border bg-background px-3 text-sm font-medium hover:bg-muted"
          >
            Raise {who}&apos;s budget
          </Link>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {task.workflow === 'agent'
            ? `Reply in a comment below: it continues ${who}'s session.`
            : 'Open the run for its output and options.'}
          {runHref && (
            <>
              {' '}
              <Link href={runHref} className="underline underline-offset-2">
                Open the run
              </Link>
            </>
          )}
        </p>
      </NeedsYou>
    ) : run.cleanup?.status === 'uncertain' && !run.cleanup.confirmed_at ? (
      <NeedsYou title="Confirm that nothing from the last run still runs" tone="danger">
        <ActionForm
          action={confirmCleanup}
          hidden={hidden}
          submit="Nothing is running; allow new runs"
          pendingLabel="Confirming…"
        >
          <p className="text-sm">
            The last run may have left processes running
            {run.cleanup.reasons?.length ? `: ${run.cleanup.reasons.join('; ')}` : ''}. Check for them, stop
            any you find, then confirm.
          </p>
        </ActionForm>
      </NeedsYou>
    ) : undefined;

  const sections = (
    <>
      {/* The Run panel polls through LiveRun; this panel has no live output, so it only watches. */}
      {busy && <RunWatch project={project} id={id} version={version} />}
      <StageTimeline
        checkpoints={stageTimeline(task.events, {
          busy,
          label: runLabel ?? 'Working',
          now: Date.now(),
        }).map((step): Checkpoint => step)}
      />

      {gate && task.stage === 'awaiting-approval' && !busy && phase !== 'unavailable' && (
        <Section title="Your decision">
          {gate.blockers.length > 0 ? (
            <p className="text-sm text-destructive">Not ready for approval: {gate.blockers.join('; ')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <ActionForm
                action={approveTask}
                hidden={{ ...hidden, head: gate.head_sha }}
                submit={`Approve ${gate.head_sha.slice(0, 12)}`}
                pendingLabel="Approving…"
              >
                <Input name="note" placeholder="Note for the pull request (optional)" />
                {blocking > 0 && (
                  <label className="flex items-center gap-2 text-sm text-destructive">
                    <input type="checkbox" name="acceptBlocking" /> Accept {blocking} blocking finding(s)
                  </label>
                )}
              </ActionForm>
              <p className="text-xs text-muted-foreground">
                Approves exactly this commit. If the branch changes, you review again.
              </p>
              <Disclosure label="Reject the change…">
                <ActionForm
                  action={rejectTask}
                  hidden={hidden}
                  submit="Reject"
                  variant="destructive"
                  pendingLabel="Rejecting…"
                >
                  <Input name="note" required placeholder="Why is this change rejected?" />
                </ActionForm>
              </Disclosure>
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

      {gateError && (
        <Section title="Gate">
          <p className="text-sm text-destructive">Gate unavailable: {gateError}</p>
        </Section>
      )}

      {gate && (
        <Section title="Change">
          <Facts>
            <Fact label="Branch">
              <span className="block truncate font-mono text-xs" title={task.worktree?.branch}>
                {task.worktree?.branch}
              </span>
            </Fact>
            <Fact label="Into">{task.worktree?.base_branch}</Fact>
            <Fact label="Head">
              <span className="font-mono text-xs">{gate.head_sha.slice(0, 12)}</span>
            </Fact>
            {task.worktree?.path && (
              <Fact label="Worktree">
                {/* Right-to-left truncation keeps the task folder, the useful end, in view. */}
                <span
                  className="block truncate text-left font-mono text-xs [direction:rtl]"
                  title={task.worktree.path}
                >
                  {task.worktree.path}
                </span>
              </Fact>
            )}
          </Facts>
          <DiffStat stat={gate.diff_stat} />
          {diffResult && !diffResult.ok && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Could not load the diff: {diffResult.error}
            </p>
          )}
          {diff && (
            <Disclosure label="Full diff" className="mt-3">
              <DiffCodeBlock code={diff} filename="Changes.diff" showLineNumbers maxHeight="32rem" />
            </Disclosure>
          )}
        </Section>
      )}

      {task.verification && (
        <Section title="Verification">
          <Facts>
            <Fact label="Result">
              <span
                className={cn(
                  'font-medium',
                  task.verification.passed ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive',
                )}
              >
                {task.verification.passed ? 'Passed' : 'Failed'}
              </span>{' '}
              <span className="text-muted-foreground">
                at <span className="font-mono text-xs">{task.verification.head_sha.slice(0, 12)}</span>
              </span>
            </Fact>
            {task.verification.runtime && (
              <Fact label="Running app">
                <span
                  className={cn(
                    task.verification.runtime === 'no' && 'text-destructive',
                    task.verification.runtime !== 'yes' &&
                      task.verification.runtime !== 'no' &&
                      'text-amber-700 dark:text-amber-400',
                  )}
                >
                  {task.verification.runtime === 'yes'
                    ? 'No faults found'
                    : task.verification.runtime === 'no'
                      ? 'Faults found'
                      : 'Could not decide. Check the running app before you approve.'}
                </span>
              </Fact>
            )}
          </Facts>
          {task.verification.not_run_locally?.length ? (
            <p
              role="note"
              className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
            >
              Not run locally: {task.verification.not_run_locally.join(', ')}. The change is too broad for
              this machine, so CI must pass before you merge.
            </p>
          ) : null}
          <Disclosure label="Output" className="mt-3">
            <pre className="max-h-80 overflow-auto rounded-lg border bg-background p-3 text-xs whitespace-pre-wrap">
              {task.verification.output_tail || 'No output.'}
            </pre>
          </Disclosure>
        </Section>
      )}

      {gate && !task.pr && (
        <Section title="Pull request draft">
          {task.pr_draft && task.pr_draft.head_sha === gate.head_sha ? (
            <>
              <p className="text-sm font-medium text-pretty">{task.pr_draft.title}</p>
              <Disclosure label="Body" className="mt-2">
                <pre className="max-h-96 overflow-auto rounded-lg border bg-background p-3 text-xs whitespace-pre-wrap">
                  {task.pr_draft.body}
                </pre>
              </Disclosure>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No draft for this commit. Run <span className="font-mono">factory task draft-pr</span> to write
              one.
            </p>
          )}
        </Section>
      )}

      {(task.attempts?.length ?? 0) > 0 && (
        <Section title="Model attempts" aside={<span className="tabular-nums">{money(task)}</span>}>
          <ul className="flex flex-col text-sm">
            {task.attempts!.map((a, i) => (
              <li
                key={i}
                className="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-2 border-b border-border/60 py-1.5 last:border-b-0"
                title={a.error ? `${a.outcome}: ${a.error}` : a.outcome}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      a.outcome === 'failed' ? 'bg-destructive' : 'bg-emerald-500',
                    )}
                  />
                  {a.step}
                </span>
                <span
                  className={cn(
                    'min-w-0 truncate text-xs text-muted-foreground',
                    a.outcome === 'failed' && 'text-destructive',
                  )}
                >
                  {a.model.replace(/^claude-/, '')} · {a.effort}
                  {a.outcome === 'failed' ? ' · failed' : ''}
                </span>
                <span className="text-right tabular-nums">
                  {a.cost_usd === null ? '?' : `$${a.cost_usd.toFixed(2)}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Links">
        <ul className="flex flex-col gap-1.5 text-sm">
          <li>
            <Link
              href={`/projects/${project}/tasks/${id}/trace`}
              className="underline-offset-2 hover:underline"
            >
              View trace
            </Link>
          </li>
          <li>
            <Link href={`/projects/${project}/tasks`} className="underline-offset-2 hover:underline">
              All tasks in {project}
            </Link>
          </li>
        </ul>
      </Section>
    </>
  );

  return { ok: true, value: { task, attention, activity, composer, sections } };
}
