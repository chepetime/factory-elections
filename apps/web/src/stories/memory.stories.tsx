import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { MemorySnapshot } from '@factory/core';
import { MemoryView } from '@/components/memory-view';

const facts: MemorySnapshot['facts'] = [
  {
    id: 'f1',
    text: 'Run `pnpm build` before `pnpm test`; tests import from dist.',
    kind: 'build',
    sessions: ['run1:coder:1', 'run1:coder:2', 'run2:coder:1'],
    status: 'active',
    created_at: '2026-11-20T10:00:00.000Z',
    updated_at: '2026-11-25T10:00:00.000Z',
  },
  {
    id: 'f2',
    text: 'Use pnpm, not npm, to install.',
    kind: 'command',
    sessions: ['run2:coder:1', 'run3:coder:1'],
    status: 'candidate',
    created_at: '2026-11-24T10:00:00.000Z',
    updated_at: '2026-11-25T10:00:00.000Z',
  },
  {
    id: 'f3',
    text: 'The API listens on port 3000.',
    kind: 'environment',
    sessions: ['run1:coder:2'],
    status: 'dropped',
    dropped_reason: 'removed by the user',
    created_at: '2026-11-18T10:00:00.000Z',
    updated_at: '2026-11-26T10:00:00.000Z',
  },
];

const session = (id: string, task: string, ok: boolean): MemorySnapshot['sources'][string] => ({
  id,
  at: '2026-11-24T09:00:00.000Z',
  kind: 'coder',
  ok,
  task,
  commands: ['pnpm test', 'pnpm build', 'pnpm test'],
  failures: ok ? [] : [{ tool: 'Bash', input: 'pnpm test', error: 'Cannot find module dist/index.js' }],
});

const snapshot: MemorySnapshot = {
  facts,
  sources: {
    'run1:coder:1': session('run1:coder:1', 'FE-9', false),
    'run1:coder:2': session('run1:coder:2', 'FE-9', true),
    'run3:coder:1': session('run3:coder:1', 'FE-12', true),
  },
  pruned_tools: ['CronCreate', 'PublishPlugin'],
  sessions: 9,
  pending: 1,
  review_cost_usd: 0.0123,
};

const meta = {
  title: 'Factory/Memory',
  component: MemoryView,
  tags: ['autodocs'],
  args: {
    project: 'demo',
    snapshot,
    showRemoved: false,
    forget: fn(async () => ({})),
    restore: fn(async () => ({})),
  },
} satisfies Meta<typeof MemoryView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithFacts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/2 of 3 confirmations/)).toBeInTheDocument();
    await expect(canvas.getByText('Show removed facts (1)')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { snapshot: { ...snapshot, facts: [], sources: {}, pruned_tools: [], sessions: 0, pending: 0 } },
};

export const RemovedFilter: Story = { args: { showRemoved: true } };

export const RpcError: Story = {
  args: { snapshot: undefined, error: 'backend unreachable at 127.0.0.1:4319' },
};

export const RemoveFails: Story = {
  args: { forget: fn(async () => ({ error: 'no fact f1' })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getAllByRole('button', { name: 'Remove' })[0]!);
    const dialog = within(document.body);
    await userEvent.click(await dialog.findByRole('button', { name: 'Remove fact' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('no fact f1');
  },
};
