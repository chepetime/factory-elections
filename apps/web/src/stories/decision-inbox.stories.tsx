import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DecisionInbox } from '@factory/affect-ui/components/decision-inbox-clean';
import { DecisionInbox as ClassicDecisionInbox } from '@factory/affect-ui/components/decision-inbox';

const meta = {
  title: 'affectUI/Components/Decision Inbox',
  component: DecisionInbox,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Official MIT source. Decisions acknowledge an answer before folding away. Callbacks here log actions only; they do not operate on project data.',
      },
    },
  },
  args: {
    onDecide: fn(),
    decisions: [
      {
        id: 'checks',
        title: 'Run the full verification suite?',
        detail: 'Quick checks passed. The full run takes about two minutes.',
        primary: 'Run checks',
        secondary: 'Later',
      },
      {
        id: 'changes',
        title: 'Keep the proposed file changes?',
        detail: 'Three files changed in this sample run.',
        primary: 'Keep changes',
        secondary: 'Discard',
        collapsed: true,
      },
    ],
  },
} satisfies Meta<typeof DecisionInbox>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Clean: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Run checks' }));
    await expect(args.onDecide).toHaveBeenCalledWith(expect.objectContaining({ id: 'checks' }), 'primary');
    await expect(canvas.getByRole('button', { name: 'Keep the proposed file changes?' })).toBeVisible();
  },
};
export const Classic: Story = { render: (args) => <ClassicDecisionInbox {...args} /> };
export const Empty: Story = { args: { decisions: [] } };
