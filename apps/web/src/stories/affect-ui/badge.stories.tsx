import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '@factory/affect-ui/components/badge-clean';
import { Badge as ClassicBadge } from '@factory/affect-ui/components/badge';

const meta = {
  title: 'affectUI/Components/Badge',
  component: Badge,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A small status label that carries the color. Official MIT source. [Usage reference](https://www.affectui.com/components/badge) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/badge-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { children: 'In progress', tone: 'info', dot: true },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicBadge {...args} /> };
