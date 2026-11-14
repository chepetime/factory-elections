import type { Meta, StoryObj } from '@storybook/react-vite';
import { NotificationStack } from '@factory/affect-ui/components/notification-stack-clean';
import { NotificationStack as ClassicNotificationStack } from '@factory/affect-ui/components/notification-stack';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Notification Stack',
  component: NotificationStack,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Notice cards stacked behind each other. Official MIT source. [Usage reference](https://www.affectui.com/components/notification-stack) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/notification-stack-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    notices: [
      {
        id: 'review',
        title: 'Review complete',
        text: 'Two findings are ready to inspect.',
        badge: 'Factory',
        action: { label: 'Open findings', onClick: fn() },
      },
      { id: 'checks', title: 'Checks passed', text: 'The latest sample run passed all quick checks.' },
    ],
    onDismiss: fn(),
  },
} satisfies Meta<typeof NotificationStack>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicNotificationStack {...args} /> };
