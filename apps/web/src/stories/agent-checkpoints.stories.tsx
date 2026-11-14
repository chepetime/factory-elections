import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AgentCheckpoints } from '@/components/agent-checkpoints';
import { AgentCheckpointsDemo } from '@/components/agent-checkpoints-demo';

const meta = {
  title: 'Factory/Agent Checkpoints',
  component: AgentCheckpoints,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Original factory implementation using shadcn, Tailwind, and Motion. Saved attempts remain in separate lanes after rewinding. The interactive demo uses sample data only.',
      },
    },
  },
  args: {
    title: 'Checkpoints',
    task: 'Implement a feature',
    head: 'retry',
    onRewind: fn(),
    checkpoints: [
      { id: 'brief', title: 'Read the brief', at: 8_000, cost: 0.02 },
      {
        id: 'build',
        parent: 'brief',
        title: 'Built the first implementation',
        at: 64_000,
        files: 3,
        cost: 0.12,
      },
      {
        id: 'failed',
        parent: 'build',
        title: 'Two validation checks failed',
        status: 'failed',
        at: 92_000,
        cost: 0.05,
      },
      {
        id: 'retry',
        parent: 'brief',
        title: 'Trying a smaller implementation',
        status: 'running',
        at: 110_000,
        cost: 0.08,
      },
    ],
  },
} satisfies Meta<typeof AgentCheckpoints>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BranchedRun: Story = {};
export const Empty: Story = { args: { checkpoints: [], head: undefined } };
export const ReadOnly: Story = { args: { onRewind: undefined } };
export const LongHistory: Story = {
  args: {
    head: 'step-17',
    checkpoints: Array.from({ length: 18 }, (_, index) => ({
      id: `step-${index}`,
      parent: index ? `step-${index - 1}` : undefined,
      title: `Saved checkpoint ${index + 1}`,
      at: index * 12_000,
    })),
  },
};
export const Interactive: Story = {
  render: () => <AgentCheckpointsDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Read the task and repository guidelines/ }));
    await expect(canvas.getByRole('status')).toHaveTextContent('Restored');
    await expect(canvas.getByRole('list', { name: 'Run checkpoints' }).children).toHaveLength(6);
    await userEvent.click(canvas.getByRole('button', { name: 'Complete checkpoint' }));
    await expect(canvas.getByRole('status')).toHaveTextContent('completed');
    await userEvent.click(canvas.getByRole('button', { name: 'Reset' }));
    await expect(canvas.getByRole('list', { name: 'Run checkpoints' }).children).toHaveLength(5);
  },
};
