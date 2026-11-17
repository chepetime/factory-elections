import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { TaskRecord, taskActions, type ExecutionPhase } from '@factory/core';
import TaskPage from '@/app/projects/[project]/tasks/[id]/page';
import { backgroundRun, readTaskControls } from '@/lib/factory';

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
