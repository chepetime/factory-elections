import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { MemoryView } from '@/components/memory-view';
import type { MemorySnapshot } from '@/lib/memory';

const at = { created_at: '2026-11-20T10:00:00.000Z', updated_at: '2026-11-25T10:00:00.000Z' };
const snapshot: MemorySnapshot = {
  facts: [
    {
      id: 'f1',
      text: 'Run `pnpm build` before `pnpm test`.',
      kind: 'build',
      status: 'active',
      ...at,
      sessions: ['a', 'b', 'c'],
    },
    {
      id: 'f2',
      text: 'Use pnpm, not npm.',
      kind: 'command',
      status: 'candidate',
      ...at,
      sessions: ['a', 'b'],
    },
    {
      id: 'f3',
      text: 'The API listens on port 3000.',
      kind: 'environment',
      status: 'dropped',
      dropped_reason: 'removed by the user',
      ...at,
      sessions: ['a'],
    },
  ],
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
    await expect(within(canvasElement).getByText(/2 of 3 confirmations/)).toBeInTheDocument();
  },
};
export const Empty: Story = {
  args: { snapshot: { ...snapshot, facts: [], pruned_tools: [], sessions: 0, pending: 0 } },
};
export const RemovedFilter: Story = { args: { showRemoved: true } };
export const RpcError: Story = { args: { snapshot: undefined, error: 'backend unreachable' } };
