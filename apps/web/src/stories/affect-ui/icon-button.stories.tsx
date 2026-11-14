import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconButton } from '@factory/affect-ui/components/icon-button-clean';
import { IconButton as ClassicIconButton } from '@factory/affect-ui/components/icon-button';
import { fn } from 'storybook/test';
import { Settings } from 'lucide-react';

const meta = {
  title: 'affectUI/Components/Icon Button',
  component: IconButton,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A square button that is only an icon. Official MIT source. [Usage reference](https://www.affectui.com/components/icon-button) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/icon-button-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    icon: <Settings aria-hidden="true" className="size-4" />,
    label: 'Project settings',
    onClick: fn(),
  },
} satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicIconButton {...args} /> };
