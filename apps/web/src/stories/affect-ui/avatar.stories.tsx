import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from '@factory/affect-ui/components/avatar-clean';
import { Avatar as ClassicAvatar } from '@factory/affect-ui/components/avatar';

const meta = {
  title: 'affectUI/Components/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          "A person's picture or initials on a soft color of their own. Official MIT source. [Usage reference](https://www.affectui.com/components/avatar) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/avatar-clean.tsx). Sample actions only log to Storybook.",
      },
    },
  },
  args: { name: 'Alex Rivera', size: 40, status: 'online' },
} satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicAvatar {...args} /> };
