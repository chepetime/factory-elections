import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { TaskRecord, taskActions, type ExecutionPhase } from '@factory/core';
import TaskPage from '@/app/projects/[project]/tasks/[id]/page';
import { backgroundRun, readDiff, readTaskControls } from '@/lib/factory';
import { getIssue } from '@/lib/issues';

vi.mock('@/lib/factory', () => ({
  readTaskControls: vi.fn(),
  backgroundRun: vi.fn(),
  readDiff: vi.fn(),
  isProjectName: () => true,
  isTaskId: (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(id),
  showTask: vi.fn(async () => ({ ok: false, error: 'not loaded in this test' })),
}));
vi.mock('@/lib/agents', () => ({
  listAgents: async () => ({
    ok: true,
    value: [{ id: 'devin', name: 'Devin', avatar: '🐸' }],
  }),
}));
vi.mock('@/lib/run-session', () => ({
  readRunSession: async () => ({ ok: true, value: { entries: [], live: false } }),
}));
vi.mock('@/lib/pane-width', () => ({ paneWidth: async (spec: { default: number }) => spec.default }));
vi.mock('@/lib/page-title', () => ({ projectLabel: async (p: string) => p, clip: (t: string) => t }));
vi.mock('@/lib/issues', () => ({ getIssue: vi.fn() }));
vi.mock('@/lib/user-settings', () => ({ userSettings: async () => ({ ok: false, error: 'not loaded' }) }));
vi.mock('@/components/issue-editor', () => ({
  IssueTitle: ({ title }: { title: string }) => <h1>{title}</h1>,
  IssueDescription: ({ description }: { description: string }) => <p>description:{description}</p>,
  IssuePriorityField: () => <span>priority</span>,
  IssueStatusField: () => <span>status</span>,
  IssueAssigneeField: () => <span>assignee</span>,
  IssueBlockedByField: ({ blockedBy }: { blockedBy?: string[] }) => (
    <span>blocked-by:{blockedBy?.join(',')}</span>
  ),
  IssueDateField: ({ field, value, overdue }: { field: string; value?: string; overdue?: boolean }) => (
    <span>
      {field}:{value ?? 'unset'}
      {overdue ? ':late' : ''}
    </span>
  ),
  IssueCommentBox: () => <span>comment-box</span>,
  IssueReplyBox: ({ parent }: { parent: string }) => <span>reply-box:{parent}</span>,
  IssueArchivedBanner: () => <span>archived-banner</span>,
}));
vi.mock('@/app/actions', () => ({
  approveAndOpenPullRequest: vi.fn(),
  approveTask: vi.fn(),
  checkTask: vi.fn(),
  dismissLog: vi.fn(),
  followUpIssue: vi.fn(),
  confirmCleanup: vi.fn(),
  openPullRequest: vi.fn(),
  rejectTask: vi.fn(),
  runTask: vi.fn(),
}));
vi.mock('next/navigation', async (load) => ({
  ...(await load<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/components/action-form', () => ({
  ActionForm: ({ submit }: { submit: string }) => <span>{submit}</span>,
}));
vi.mock('@/components/task-chat', () => ({
  ChatScroll: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TaskChatComposer: ({ mode }: { mode: string }) => <span>composer:{mode}</span>,
}));

const task = TaskRecord.parse({
  id: '11111111-2222-4333-8444-555555555555',
  project: 'demo',
  repo: '/r',
  prompt: 'Fix it',
  stage: 'coding',
  worktree: { path: '/w', branch: 'factory/test', base_branch: 'main' },
});
function issue(run?: { id: string; stage: TaskRecord['stage']; waiting?: boolean }) {
  return {
    number: 1,
    key: 'DE-1',
    title: 'Fix it',
    description: 'Fix it',
    status: 'in_progress' as const,
    stored_status: 'todo' as const,
    status_at: '2026-01-01T00:00:00.000Z',
    priority: 'none' as const,
    runs: run ? [run.id] : [],
    blocked_by: [] as string[],
    comments: [],
    events: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    run,
  };
}
function observe(phase: ExecutionPhase, stage = task.stage) {
  const current = { ...task, stage };
  vi.mocked(getIssue).mockResolvedValue({ ok: true, value: issue({ id: task.id, stage }) });
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: { task: current, execution: phase, actions: taskActions(current, phase) },
  });
  vi.mocked(backgroundRun).mockResolvedValue({
    running: ['queued', 'running', 'finalizing'].includes(phase),
    phase,
  });
}
async function html(start?: string, panel?: 'run' | 'status' | 'timeline' | 'changes' | 'details') {
  return renderToStaticMarkup(
    await TaskPage({
      params: Promise.resolve({ project: 'demo', id: 'DE-1' }),
      searchParams: Promise.resolve({ start, ...(panel ? { panel } : {}) }),
    }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getIssue).mockResolvedValue({ ok: true, value: issue({ id: task.id, stage: task.stage }) });
});

it('stops polling an interrupted coding task and offers explicit recovery', async () => {
  observe('interrupted');
  const page = await html(undefined, 'status');
  expect(page).toContain('no live owner');
  expect(page).toContain('Run task');
  expect(page).not.toContain('data-live-run');
});
it('offers revision after approval and never unlocks commands on an unavailable observation', async () => {
  observe('completed', 'approved');
  expect(await html(undefined, 'status')).toContain('composer:revise');
  vi.mocked(backgroundRun).mockResolvedValue({ running: false, phase: 'unavailable' });
  const page = await html(undefined, 'status');
  expect(page).toContain('comment-box');
  expect(page).toContain('Execution status is unavailable');
  expect(page).not.toContain('Push and open pull request');
});
it('keeps finalizing busy and explains partial submission success', async () => {
  observe('finalizing', 'awaiting-approval');
  const page = await html('failed', 'status');
  expect(page).toContain('data-live-run');
  expect(page).toContain('Saving evidence and releasing the task');
  expect(page).toContain('Task saved, but the run could not start');
  expect(page).not.toContain('composer:revise');
});

it('does not unlock commands when the controls observation failed but a later log read succeeds', async () => {
  observe('unavailable', 'approved');
  vi.mocked(backgroundRun).mockResolvedValue({ running: false, phase: 'completed' });
  const page = await html(undefined, 'status');
  expect(page).toContain('comment-box');
  expect(page).toContain('Execution status is unavailable');
});

it('shows model attempts and their combined cost, preserving unknown costs', async () => {
  observe('completed');
  const attempt = {
    step: 'coder',
    rung: 'first',
    model: 'claude-sonnet',
    effort: 'high' as const,
    started_at: '2026-01-01',
    finished_at: '2026-01-01',
    outcome: 'completed' as const,
    cost_usd: 1.25,
  };
  const withAttempts = {
    ...task,
    attempts: [
      attempt,
      {
        ...attempt,
        step: 'reviewer',
        model: 'codex',
        outcome: 'failed' as const,
        cost_usd: 0.5,
        error: 'timeout',
      },
    ],
  };
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: { task: withAttempts, execution: 'completed', actions: taskActions(withAttempts, 'completed') },
  });
  const page = await html(undefined, 'details');
  expect(page).toContain('Model attempts');
  expect(page).toMatch(/Blocked by[\s\S]*blocked-by:/);
  expect(page).toMatch(/>sonnet · /);
  expect(page).toContain('codex');
  expect(page).toContain('failed: timeout');
  expect(page).toContain('$1.75');
  expect(page).toContain('$1.25');
  const unknown = { ...withAttempts, attempts: [attempt, { ...attempt, cost_usd: null }] };
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: { task: unknown, execution: 'completed', actions: taskActions(unknown, 'completed') },
  });
  expect(await html(undefined, 'details')).toContain('unknown');
});

it('shows the approval diff in a copyable code view and reports read errors', async () => {
  observe('completed', 'awaiting-approval');
  const current = { ...task, stage: 'awaiting-approval' as const };
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: {
      task: current,
      execution: 'completed',
      actions: taskActions(current, 'completed'),
      head_sha: 'abcdef123456',
      diff_stat: 'file | 1 +',
    },
  });
  vi.mocked(readDiff).mockResolvedValueOnce({
    ok: true,
    value: 'diff --git a/a b/a\n--- a/a\n+++ b/a\n-old line\n+new line\n',
  });
  const page = await html(undefined, 'details');
  expect(page).toContain('Full diff');
  expect(page).toContain('Changes.diff');
  expect(page).toContain('+new line');
  // Line 4 is the deletion and line 5 the addition; the --- and +++ headers are neither.
  const diffLines = [
    ...page.slice(page.indexOf('Changes.diff')).matchAll(/data-slot="code-line"([^>]*)>/g),
  ].map((m) => /data-diff="(\w+)"/.exec(m[1]!)?.[1] ?? null);
  expect(diffLines).toEqual([null, null, null, 'del', 'add']);
  expect(page).toContain('Copy code');
  vi.mocked(readDiff).mockResolvedValueOnce({ ok: false, error: 'unavailable' });
  expect(await html(undefined, 'details')).toContain('Could not load the diff: unavailable');
});

it('renders review findings and stage events through the shared components', async () => {
  observe('completed');
  const reviewed = {
    ...task,
    stage: 'awaiting-approval' as const,
    events: [
      { kind: 'stage:queued', message: 'Task submitted', at: '2026-01-01T00:00:00Z' },
      { kind: 'stage:awaiting-approval', message: 'Review ready', at: '2026-01-01T00:01:00Z' },
    ],
    review: {
      verdict: 'request-changes' as const,
      summary: 'Please fix',
      head_sha: 'abc',
      at: '2026-01-01T00:01:00Z',
      findings: [{ severity: 'blocking' as const, message: 'Missing check', file: 'src/a.ts' }],
    },
  };
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: { task: reviewed, execution: 'completed', actions: taskActions(reviewed, 'completed') },
  });
  const details = await html(undefined, 'details');
  expect(details).toContain('Stage timeline');
  expect(details).toMatch(/aria-current="step"[\s\S]*Review ready/);
  // Findings sit with the run, in the Run panel.
  const page = await html(undefined, 'status');
  expect(page).toContain('Review findings');
  expect(page).toContain('Missing check');
  expect(page).toContain('src/a.ts');
  expect(page).not.toContain('Saved checkpoint');
});
it('shows command output of a failed step and the last run output as copyable code blocks', async () => {
  const failed = {
    ...task,
    stage: 'failed' as const,
    events: [
      {
        at: '2026-11-18T12:47:00.000Z',
        kind: 'stage:failed',
        message: 'Worktree setup (`pnpm install`) exited with status 1.\naws: [ERROR] Token has expired',
      },
    ],
  };
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: { task: failed, execution: 'completed', actions: taskActions(failed, 'completed') },
  });
  vi.mocked(backgroundRun).mockResolvedValue({
    running: false,
    phase: 'completed',
    logTail: '$ pnpm install\nexit 1',
  });
  const page = await html(undefined, 'status');
  expect(page).toContain('Worktree setup (`pnpm install`) exited with status 1.');
  expect(page).toMatch(/data-slot="code-block"[\s\S]*aws: \[ERROR\] Token has expired/);
  expect(page).toMatch(/data-tone="destructive"[\s\S]*Error output[\s\S]*Token has expired/);
  expect(page.match(/data-tone="destructive"/g)).toHaveLength(1);
  expect(page).toContain('Copy');
  expect(page).toMatch(/data-slot="code-block"[\s\S]*\$ pnpm install/);
  expect(page).not.toContain('Token has expired</span><time');
});
it('while a run works: a stop composer, the latest activity and the following live output', async () => {
  observe('running');
  vi.mocked(backgroundRun).mockResolvedValue({
    running: true,
    phase: 'running',
    logTail:
      'Coder attempt 1/3 on sonnet-medium…\n$ pnpm install --frozen-lockfile   # setup\nProgress: resolved 3784',
  });
  const page = await html(undefined, 'status');
  expect(page).toContain('composer:running');
  // The current command is the latest step under the run line.
  expect(page).toMatch(/<li[^>]*>(?:(?!<\/li>)[\s\S])*\$ pnpm install --frozen-lockfile/);
  expect(page).toMatch(/aria-label="Live output"[\s\S]*Progress: resolved 3784/);
  expect(await html(undefined, 'details')).toMatch(/Stage timeline[\s\S]*running/);
});
it('a silent command shows its elapsed time and a notice that it is still running', async () => {
  observe('running');
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  vi.mocked(backgroundRun).mockResolvedValue({
    running: true,
    phase: 'running',
    logTail: 'Progress: resolved 3784',
    activity: {
      run_started_at: minutesAgo(16),
      command: 'pnpm install --frozen-lockfile',
      command_started_at: minutesAgo(15),
      last_output_at: minutesAgo(14),
    },
  });
  const page = await html(undefined, 'status');
  // The current command is the latest step under the run line.
  expect(page).toMatch(/<li[^>]*>(?:(?!<\/li>)[\s\S])*\$ pnpm install --frozen-lockfile/);
  expect(page).toMatch(/15m[\s\S]*no output for 14m/);
  expect(page).toMatch(/role="status"[^>]*>[\s\S]*No output for 14m/);
});
it('says which checks did not run locally and that CI must pass', async () => {
  const current = TaskRecord.parse({
    ...task,
    stage: 'awaiting-approval',
    verification: {
      passed: true,
      head_sha: 'abc123abc123abc',
      at: '2026-11-18T00:00:00.000Z',
      output_tail: '',
      not_run_locally: ['test', 'full_check'],
    },
  });
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: { task: current, execution: 'completed', actions: taskActions(current, 'completed') },
  });
  vi.mocked(backgroundRun).mockResolvedValue({ running: false, phase: 'completed' });
  expect(await html(undefined, 'details')).toMatch(
    /Not run locally: test, full_check\.[\s\S]*CI must pass before you merge/,
  );
});
it('ends a successful run with a ready card, the findings, and earlier errors folded', async () => {
  const at = (m: number) => `2026-11-18T00:${String(m).padStart(2, '0')}:00.000Z`;
  const current = TaskRecord.parse({
    ...task,
    stage: 'awaiting-approval',
    events: [
      { at: at(0), kind: 'stage:submitted', message: 'Task submitted' },
      {
        at: at(1),
        kind: 'stage:failed',
        message: 'Verification failed for an environment reason.\n\n```\nold-error-line\n```',
      },
      { at: at(2), kind: 'stage:awaiting-approval', message: 'Review ready' },
    ],
    verification: {
      passed: true,
      head_sha: 'abc123abc123abc',
      at: at(2),
      output_tail: '',
      not_run_locally: ['test'],
    },
    review: {
      verdict: 'approve',
      summary: 'Looks right.',
      at: at(2),
      head_sha: 'abc123abc123abc',
      findings: [
        { severity: 'nit', message: 'Tiny thing' },
        { severity: 'minor', message: 'Deprecated package', file: 'pnpm-lock.yaml' },
      ],
    },
  });
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: {
      task: current,
      execution: 'completed',
      head_sha: 'abc123abc123abc',
      diff_stat: ' a | 1 +\n 2 files changed, 134 insertions(+), 57 deletions(-)',
      actions: taskActions(current, 'completed', 'abc123abc123abc'),
    },
  });
  vi.mocked(backgroundRun).mockResolvedValue({ running: false, phase: 'completed' });
  vi.mocked(readDiff).mockResolvedValue({ ok: true, value: '' });
  const page = await html(undefined, 'status');
  expect(page).toMatch(/aria-label="Ready for your approval"[\s\S]*Ready for your approval/);
  expect(page).toContain('2 files changed, 134 insertions(+), 57 deletions(-)');
  expect(page).toContain('Approved · 1 minor, 1 nit');
  expect(page).toMatch(/not run locally: test\. CI must pass/);
  expect(page).toMatch(/minor<\/span>[\s\S]*Deprecated package[\s\S]*nit<\/span>[\s\S]*Tiny thing/);
  expect(page).toMatch(/<details[^>]*><summary[^>]*>Error output \(a later run went past this failure\)/);
  expect(page).toMatch(
    /Ready for your approval[\s\S]*role="group" aria-label="Your options"|Ready for your approval[\s\S]*aria-label="Your options"/,
  );
  expect(page).toMatch(
    /Approve and open draft PR[\s\S]*Approve only[\s\S]*for="chat-input"[^>]*>Ask for changes/,
  );
  expect(page).toContain('Reject the change…');
});

it('a run id opens the task that owns it, keeping the start flag', async () => {
  observe('completed');
  await expect(
    TaskPage({
      params: Promise.resolve({ project: 'demo', id: task.id }),
      searchParams: Promise.resolve({ start: 'failed' }),
    }),
  ).rejects.toMatchObject({ digest: expect.stringContaining('/projects/demo/tasks/DE-1?start=failed') });
});

it('a task without a run shows its description and takes comments', async () => {
  vi.mocked(getIssue).mockResolvedValue({ ok: true, value: issue() });
  const page = await html();
  expect(page).toContain('description:Fix it');
  expect(page).toContain('comment-box');
  expect(page).not.toContain('composer:');
  expect(vi.mocked(readTaskControls)).not.toHaveBeenCalled();
});

it('sums up the task under its title: status, priority, agent, creator, dates and feature', async () => {
  vi.mocked(getIssue).mockResolvedValue({
    ok: true,
    value: { ...issue(), created_by: 'you', start_date: '2026-01-02', due_date: '2026-01-03' },
  });
  const page = await html();
  const summary = page.slice(page.indexOf('aria-label="Summary"'), page.indexOf('description:Fix it'));
  expect(summary).toMatch(/Status[\s\S]*status[\s\S]*Priority[\s\S]*priority[\s\S]*Agent[\s\S]*assignee/);
  expect(summary).toMatch(/Created by[\s\S]*>You</);
  expect(summary).toContain('start_date:2026-01-02');
  // A due date in the past on an open task shows as late.
  expect(summary).toMatch(/Due date \(late\)[\s\S]*due_date:2026-01-03:late/);
  expect(summary).toMatch(/Feature[\s\S]*None/);

  // A task from a feature links to it; an old task without a creator says so.
  observe('completed', 'coding');
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: {
      task: { ...task, ticket: { feature: 'checkout', id: 't1' } },
      execution: 'completed',
      actions: taskActions(task, 'completed'),
    },
  });
  const linked = await html();
  expect(linked).toContain('href="/projects/demo/features/checkout"');
  expect(linked).toMatch(/Created by[\s\S]*Not recorded/);
  expect(linked).toContain('due_date:unset');
});

it('has Run, Timeline, Changes and Details tabs; the timeline and the diff each have their own', async () => {
  observe('completed', 'coding');
  const timeline = await html(undefined, 'timeline');
  expect(timeline).toMatch(/aria-current="page"[^>]*>Timeline</);
  expect(timeline).toMatch(/Ticket timeline[\s\S]*Nothing has happened yet/);
  expect(timeline).not.toContain('Execution log');

  vi.mocked(readDiff).mockResolvedValue({
    ok: true,
    value: [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1..2 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1,2 @@',
      '-old',
      '+new',
      '+more',
    ].join('\n'),
  });
  const changes = await html(undefined, 'changes');
  expect(vi.mocked(readDiff)).toHaveBeenCalledWith('demo', task.id);
  expect(changes).toMatch(/aria-current="page"[^>]*>Changes</);
  expect(changes).toContain('1 file changed');
  expect(changes).toMatch(/src\/a\.ts[\s\S]*Modified[\s\S]*\+2[\s\S]*−1/);

  vi.mocked(readDiff).mockResolvedValue({ ok: false, error: 'no worktree' });
  expect(await html(undefined, 'changes')).toContain('Changes unavailable: no worktree');
  vi.mocked(readDiff).mockClear();
  await html(undefined, 'details');
  expect(vi.mocked(readDiff)).not.toHaveBeenCalled();
});

it('lists the runs and pull requests in the side panel', async () => {
  observe('completed', 'coding');
  let page = await html(undefined, 'details');
  expect(page).toMatch(/Execution log[\s\S]*Run 1[\s\S]*Coding/);
  expect(page).toContain('No pull request yet.');
  expect(page).not.toContain('Nothing has happened yet');

  const opened = {
    ...task,
    stage: 'pr-opened' as const,
    pr: {
      url: 'https://github.com/o/r/pull/12',
      head_sha: 'abcdef1234567890',
      branch: 'factory/test',
      at: '2026-01-02T00:00:00.000Z',
    },
  };
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: { task: opened, execution: 'completed', actions: taskActions(opened, 'completed') },
  });
  page = await html(undefined, 'details');
  expect(page).toContain('o/r#12');
  expect(page).not.toContain('No pull request yet.');
  // An open PR is continued by a follow-up on the same branch, not by a new run.
  expect(page).toContain('Follow up');
  expect(page).toContain('Resolve merge conflicts');
});

it('folds runs of events and shows comment threads with their replies', async () => {
  const at = (m: number) => `2026-01-01T00:${String(m).padStart(2, '0')}:00.000Z`;
  vi.mocked(getIssue).mockResolvedValue({
    ok: true,
    value: {
      ...issue(),
      events: [
        { at: at(1), kind: 'created', message: 'Created' },
        {
          at: at(2),
          kind: 'move:todo',
          message: 'Changed status from Backlog to Todo',
          from: 'backlog',
          to: 'todo',
        },
        { at: at(5), kind: 'edit:title', message: 'Changed the title' },
      ],
      comments: [
        { id: 'c1', at: at(3), body: 'First thought', author: 'you' },
        { id: 'c2', at: at(4), body: 'A reply', parent: 'c1', author: 'devin' },
      ],
    },
  });
  const page = await html();
  expect(page).toMatch(/2 activities[\s\S]*Created[\s\S]*Backlog to Todo/);
  expect(page).toMatch(/First thought[\s\S]*A reply[\s\S]*reply-box:c1[\s\S]*Changed the title/);
  expect(page).toContain('1 reply');
  expect(page).toMatch(/Devin<\/span>[\s\S]*A reply/);
  expect(page.match(/activities/g)).toHaveLength(1);
});

it('names the agent, not Factory, in an agent run', async () => {
  const agentRun = { ...task, workflow: 'agent' as const, agent: 'devin' };
  vi.mocked(getIssue).mockResolvedValue({ ok: true, value: issue({ id: task.id, stage: 'coding' }) });
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: { task: agentRun, execution: 'running', actions: taskActions(agentRun, 'running') },
  });
  vi.mocked(backgroundRun).mockResolvedValue({ running: true, phase: 'running' });
  const page = await html();
  expect(page).toMatch(/🐸[\s\S]*Devin/);
  expect(page).not.toMatch(/>Factory</);
});

it('opens the run in the right panel, with its session, and keeps a short card in the feed', async () => {
  observe('completed', 'awaiting-approval');
  const page = await html();
  expect(page).toMatch(/aria-label="Panel"[\s\S]*aria-current="page"[^>]*>Run</);
  expect(page).toContain('No session recorded for this run yet.');
  expect(page).toMatch(/Run 1<\/span>/);
  const details = await html(undefined, 'details');
  expect(details).toMatch(/href="[^"]*panel=run"[^>]*>Open</);
  expect(details).not.toContain('Properties');
});

it('puts what the run needs from you on the ticket, also with the Details tab open', async () => {
  // At the gate: the ready card and the decision, without opening the Run tab.
  const ready = TaskRecord.parse({
    ...task,
    workflow: 'agent',
    agent: 'devin',
    stage: 'awaiting-approval',
    verification: { passed: true, head_sha: 'abc123abc123abc', at: '2026-01-01T00:00:00Z', output_tail: '' },
  });
  vi.mocked(getIssue).mockResolvedValue({
    ok: true,
    value: issue({ id: task.id, stage: 'awaiting-approval' }),
  });
  vi.mocked(backgroundRun).mockResolvedValue({ running: false, phase: 'completed' });
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: {
      task: ready,
      execution: 'completed',
      head_sha: 'abc123abc123abc',
      diff_stat: ' 1 file changed, 2 insertions(+)',
      actions: taskActions(ready, 'completed', 'abc123abc123abc'),
    },
  });
  let page = await html(undefined, 'details');
  expect(page).toContain('Ready for your approval');
  expect(page).toContain('Approve and open draft PR');
  expect(page).toMatch(/href="\/projects\/demo\/tasks\/DE-1\?panel=run"[^>]*>Ask for changes/);

  // The Run tab is the chat only: the status cards live in their own tab, one link away.
  const chat = await html(undefined, 'run');
  expect(chat).toMatch(/aria-current="page"[^>]*>Run</);
  expect(chat).toContain('href="/projects/demo/tasks/DE-1?panel=status"');
  expect(chat).toContain('Open Status and actions');
  expect(chat).not.toContain('Status and actions</h3>');
  const status = await html(undefined, 'status');
  expect(status).toMatch(/aria-current="page"[^>]*>Status</);
  expect(status).toContain('Ready for your approval');

  // Approved: the push button is on the ticket.
  const approved = {
    ...ready,
    stage: 'approved' as const,
    approval: { decision: 'approved' as const, head_sha: 'abc123abc123abc', at: '2026-01-01T00:00:00Z' },
  };
  vi.mocked(getIssue).mockResolvedValue({ ok: true, value: issue({ id: task.id, stage: 'approved' }) });
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: {
      task: approved,
      execution: 'completed',
      head_sha: 'abc123abc123abc',
      diff_stat: '',
      actions: taskActions(approved, 'completed', 'abc123abc123abc'),
    },
  });
  page = await html(undefined, 'details');
  expect(page).toContain('Approved: open the pull request');
  expect(page).toContain('Push and open pull request');

  // Blocked: the agent's question is on the ticket, with how to answer.
  const blocked = TaskRecord.parse({
    ...task,
    workflow: 'agent',
    agent: 'devin',
    stage: 'blocked',
    events: [{ at: '2026-01-01T00:00:00Z', kind: 'stage:blocked', message: 'devin needs you. Which page?' }],
  });
  vi.mocked(getIssue).mockResolvedValue({ ok: true, value: issue({ id: task.id, stage: 'blocked' }) });
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: { task: blocked, execution: 'completed', actions: taskActions(blocked, 'completed') },
  });
  page = await html(undefined, 'details');
  expect(page).toContain('needs you');
  expect(page).toContain('Which page?');
  expect(page).toContain('Reply in a comment below');
  // Its work may be done (a spent budget): the factory's checks run again with no agent turn.
  expect(page).toContain('Run the checks again');
});

it('puts the actions after the newest activity, and hides the follow-up form while one waits', async () => {
  const ready = TaskRecord.parse({
    ...task,
    workflow: 'agent',
    agent: 'devin',
    stage: 'awaiting-approval',
    verification: { passed: true, head_sha: 'abc123abc123abc', at: '2026-01-01T00:00:00Z', output_tail: '' },
  });
  const latest = {
    id: 'c1',
    at: '2026-01-03T00:00:00.000Z',
    body: 'The newest note on the task',
    author: 'devin',
  };
  vi.mocked(getIssue).mockResolvedValue({
    ok: true,
    value: { ...issue({ id: task.id, stage: 'awaiting-approval' }), comments: [latest] },
  });
  vi.mocked(backgroundRun).mockResolvedValue({ running: false, phase: 'completed' });
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: {
      task: ready,
      execution: 'completed',
      head_sha: 'abc123abc123abc',
      diff_stat: ' 1 file changed',
      actions: taskActions(ready, 'completed', 'abc123abc123abc'),
    },
  });
  const page = await html(undefined, 'details');
  expect(page.indexOf('The newest note on the task')).toBeGreaterThan(-1);
  expect(page.indexOf('The newest note on the task')).toBeLessThan(page.indexOf('Ready for your approval'));

  // A follow-up waits for Devin: the run is still at pr-opened, but no second one can be started.
  const opened = {
    ...task,
    stage: 'pr-opened' as const,
    pr: {
      url: 'https://github.com/o/r/pull/12',
      head_sha: 'abcdef1234567890',
      branch: 'factory/test',
      at: '2026-01-02T00:00:00.000Z',
    },
  };
  vi.mocked(getIssue).mockResolvedValue({
    ok: true,
    value: issue({ id: task.id, stage: 'pr-opened', waiting: true }),
  });
  vi.mocked(readTaskControls).mockResolvedValue({
    ok: true,
    value: { task: opened, execution: 'completed', actions: taskActions(opened, 'completed') },
  });
  const waiting = await html(undefined, 'details');
  expect(waiting).not.toContain('Resolve merge conflicts');
});
