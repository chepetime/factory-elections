import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@factory/affect-ui/components/button-clean';
import { Button as ClassicButton } from '@factory/affect-ui/components/button';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Primary, secondary, ghost and destructive buttons with icons, sizes and a shimmering loading state. Official MIT source. [Usage reference](https://www.affectui.com/components/button) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/button-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { children: 'Run checks', type: 'button', variant: 'primary', onClick: fn() },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicButton {...args} /> };
