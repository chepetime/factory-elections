import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AgentFindings } from '@/components/agent-findings';
import { AgentFindingsDemo } from '@/components/agent-findings-demo';

const meta = {
  title: 'Factory/Agent Findings',
  component: AgentFindings,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Original factory review feed. Select an agent to filter, open a finding for details, and feed new data through props. Demo findings are fictional.',
      },
    },
  },
  args: {
    title: 'Verification',
    now: 60_000,
    rows: 4,
    onOpen: fn(),
    agents: [
      { id: 'security', name: 'Security', step: 'Checking API authorization', done: 5, total: 24 },
      { id: 'tests', name: 'Test runner', step: 'Exercising task transitions', done: 4, total: 18 },
    ],
    findings: [
      {
        id: 'auth',
        agentId: 'security',
        title: 'Task endpoint needs an ownership check',
        severity: 'critical',
        at: 48_000,
        location: 'tasks/route.ts:28',
      },
      {
        id: 'retry',
        agentId: 'tests',
        title: 'Retry path has no regression coverage',
        severity: 'warning',
        at: 60_000,
        location: 'tasks.test.ts:96',
      },
    ],
  },
} satisfies Meta<typeof AgentFindings>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};
export const Empty: Story = { args: { agents: [], findings: [] } };
export const NoFindings: Story = { args: { findings: [] } };
export const Completed: Story = {
  args: { agents: meta.args.agents.map((agent) => ({ ...agent, done: agent.total })) },
};
export const Interactive: Story = {
  render: () => <AgentFindingsDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Type checker/ }));
    await expect(canvas.getByText('No findings from this agent yet.')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Run next checks' }));
    await userEvent.click(
      await canvas.findByRole('button', { name: /^Task status is wider than its contract/ }),
    );
    await expect(canvas.getByRole('region', { name: 'Finding details' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Close finding details' }));
    await expect(canvas.queryByRole('region', { name: 'Finding details' })).not.toBeInTheDocument();
  },
};
