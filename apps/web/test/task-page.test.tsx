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
vi.mock('@/lib/page-title', () => ({ projectLabel: async (p: string) => p, clip: (t: string) => t }));
vi.mock('@/lib/issues', () => ({ getIssue: vi.fn() }));
vi.mock('@/components/issue-editor', () => ({
  IssueTitle: ({ title }: { title: string }) => <h1>{title}</h1>,
  IssueDescription: ({ description }: { description: string }) => <p>description:{description}</p>,
  IssuePriorityField: () => <span>priority</span>,
  IssueStatusField: () => <span>status</span>,
  IssueCommentBox: () => <span>comment-box</span>,
  IssueArchivedBanner: () => <span>archived-banner</span>,
}));
vi.mock('@/app/actions', () => ({
  approveAndOpenPullRequest: vi.fn(),
  approveTask: vi.fn(),
  dismissLog: vi.fn(),
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
function issue(run?: { id: string; stage: TaskRecord['stage'] }) {
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
async function html(start?: string) {
  return renderToStaticMarkup(
    await TaskPage({
      params: Promise.resolve({ project: 'demo', id: 'DE-1' }),
      searchParams: Promise.resolve({ start }),
    }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getIssue).mockResolvedValue({ ok: true, value: issue({ id: task.id, stage: task.stage }) });
});

it('stops polling an interrupted coding task and offers explicit recovery', async () => {
  observe('interrupted');
  const page = await html();
  expect(page).toContain('no live owner');
  expect(page).toContain('Run task');
  expect(page).not.toContain('data-live-run');
});
it('offers revision after approval and never unlocks commands on an unavailable observation', async () => {
  observe('completed', 'approved');
  expect(await html()).toContain('composer:revise');
  vi.mocked(backgroundRun).mockResolvedValue({ running: false, phase: 'unavailable' });
  const page = await html();
  expect(page).toContain('comment-box');
  expect(page).toContain('Execution status is unavailable');
  expect(page).not.toContain('Push and open pull request');
});
it('keeps finalizing busy and explains partial submission success', async () => {
  observe('finalizing', 'awaiting-approval');
  const page = await html('failed');
  expect(page).toContain('data-live-run');
  expect(page).toContain('Saving evidence and releasing the task');
  expect(page).toContain('Task saved, but the run could not start');
  expect(page).not.toContain('composer:revise');
});

it('does not unlock commands when the controls observation failed but a later log read succeeds', async () => {
  observe('unavailable', 'approved');
  vi.mocked(backgroundRun).mockResolvedValue({ running: false, phase: 'completed' });
  const page = await html();
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
  const page = await html();
  expect(page).toContain('Model attempts');
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
  expect(await html()).toContain('unknown');
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
  const page = await html();
  expect(page).toContain('Full diff');
  expect(page).toContain('Changes.diff');
  expect(page).toContain('+new line');
  // Line 4 is the deletion and line 5 the addition.
  expect(page).toContain(':nth-child(n+4):nth-child(-n+4){background:var(--diff-del-bg)}');
  expect(page).toContain(':nth-child(n+5):nth-child(-n+5){background:var(--diff-add-bg)}');
  expect(page).toContain('Copy code');
  vi.mocked(readDiff).mockResolvedValueOnce({ ok: false, error: 'unavailable' });
  expect(await html()).toContain('Could not load the diff: unavailable');
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
  const page = await html();
  expect(page).toContain('Stage timeline');
  expect(page).toMatch(/aria-current="step"[\s\S]*Review ready/);
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
  const page = await html();
  expect(page).toContain('Worktree setup (`pnpm install`) exited with status 1.');
  expect(page).toMatch(/ui-codec[\s\S]*aws: \[ERROR\] Token has expired/);
  expect(page).toMatch(/data-tone="danger"[\s\S]*Error output[\s\S]*Token has expired/);
  expect(page.match(/data-tone="danger"/g)).toHaveLength(1);
  expect(page).toContain('Copy');
  expect(page).toMatch(/ui-codec[\s\S]*\$ pnpm install/);
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
  const page = await html();
  expect(page).toContain('composer:running');
  expect(page).toContain('Now: $ pnpm install --frozen-lockfile');
  expect(page).toMatch(/aria-label="Live output"[\s\S]*Progress: resolved 3784/);
  expect(page).toMatch(/Stage timeline[\s\S]*running/);
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
  const page = await html();
  expect(page).toContain('Now: $ pnpm install --frozen-lockfile');
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
  expect(await html()).toMatch(/Not run locally: test, full_check\.[\s\S]*CI must pass before you merge/);
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
  const page = await html();
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

it('lists the runs and pull requests in the side panel', async () => {
  observe('completed', 'coding');
  let page = await html();
  expect(page).toMatch(/Execution log[\s\S]*Run 1[\s\S]*Coding/);
  expect(page).toContain('No pull request yet.');
  expect(page).toMatch(/Project[\s\S]*demo/);

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
  page = await html();
  expect(page).toContain('o/r#12');
  expect(page).not.toContain('No pull request yet.');
});
