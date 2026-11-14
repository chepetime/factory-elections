import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProfileMenu } from '@factory/affect-ui/components/profile-menu-clean';
import { ProfileMenu as ClassicProfileMenu } from '@factory/affect-ui/components/profile-menu';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Profile Menu',
  component: ProfileMenu,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Account card with the signed-in user, menu actions and profile setup progress. Official MIT source. [Usage reference](https://www.affectui.com/components/profile-menu) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/profile-menu-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    name: 'Alex Rivera',
    email: 'alex@example.com',
    items: [
      { id: 'settings', label: 'Settings', onSelect: fn() },
      { id: 'docs', label: 'Documentation', onSelect: fn() },
    ],
    setup: { done: 2, total: 4, next: 'Connect a project', onContinue: fn() },
  },
} satisfies Meta<typeof ProfileMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicProfileMenu {...args} /> };
