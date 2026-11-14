import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChangeSummary } from '@factory/affect-ui/components/change-summary-clean';
import { ChangeSummary as ClassicChangeSummary } from '@factory/affect-ui/components/change-summary';

const meta = {
  title: 'affectUI/Components/Change Summary',
  component: ChangeSummary,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'What moved since last time. Official MIT source. [Usage reference](https://www.affectui.com/components/change-summary) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/change-summary-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    title: 'What changed',
    period: 'This week',
    changes: [
      { label: 'Completed tasks', change: 'Up 18% to 42', tone: 'good' },
      { label: 'Failed checks', change: 'Down 3 to 2', tone: 'good', direction: 'down' },
      { label: 'Open decisions', change: 'Holding at 4', tone: 'neutral' },
    ],
  },
} satisfies Meta<typeof ChangeSummary>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicChangeSummary {...args} /> };
