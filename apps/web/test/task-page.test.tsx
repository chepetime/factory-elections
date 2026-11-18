import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { TaskRecord, taskActions, type ExecutionPhase } from '@factory/core';
import TaskPage from '@/app/projects/[project]/tasks/[id]/page';
import { backgroundRun, readDiff, readTaskControls } from '@/lib/factory';

vi.mock('@/lib/factory', () => ({
  readTaskControls: vi.fn(),
  backgroundRun: vi.fn(),
  readDiff: vi.fn(),
  isProjectName: () => true,
  isTaskId: () => true,
}));
vi.mock('@/app/actions', () => ({
  approveTask: vi.fn(),
  dismissLog: vi.fn(),
  openPullRequest: vi.fn(),
  rejectTask: vi.fn(),
  runTask: vi.fn(),
}));
vi.mock('@/components/auto-refresh', () => ({ AutoRefresh: () => <span>polling</span> }));
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
function observe(phase: ExecutionPhase, stage = task.stage) {
  const current = { ...task, stage };
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
      params: Promise.resolve({ project: 'demo', id: task.id }),
      searchParams: Promise.resolve({ start }),
    }),
  );
}
beforeEach(() => vi.resetAllMocks());

it('stops polling an interrupted coding task and offers explicit recovery', async () => {
  observe('interrupted');
  const page = await html();
  expect(page).toContain('no live owner');
  expect(page).toContain('Run task');
  expect(page).not.toContain('polling');
});
it('offers revision after approval and never unlocks commands on an unavailable observation', async () => {
  observe('completed', 'approved');
  expect(await html()).toContain('composer:revise');
  vi.mocked(backgroundRun).mockResolvedValue({ running: false, phase: 'unavailable' });
  const page = await html();
  expect(page).toContain('composer:locked');
  expect(page).toContain('Execution status is unavailable');
  expect(page).not.toContain('Push and open pull request');
});
it('keeps finalizing busy and explains partial submission success', async () => {
  observe('finalizing', 'awaiting-approval');
  const page = await html('failed');
  expect(page).toContain('polling');
  expect(page).toContain('Saving evidence and releasing the task');
  expect(page).toContain('Task saved, but the run could not start');
  expect(page).not.toContain('composer:revise');
});

it('does not unlock commands when the controls observation failed but a later log read succeeds', async () => {
  observe('unavailable', 'approved');
  vi.mocked(backgroundRun).mockResolvedValue({ running: false, phase: 'completed' });
  const page = await html();
  expect(page).toContain('composer:locked');
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
  expect(page).toContain('claude-sonnet');
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
  expect(page).toContain('Latest stage');
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
