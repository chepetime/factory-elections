import type { Meta, StoryObj } from '@storybook/react-vite';
import { Breadcrumb } from '@factory/affect-ui/components/breadcrumb-clean';
import { Breadcrumb as ClassicBreadcrumb } from '@factory/affect-ui/components/breadcrumb';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Breadcrumb',
  component: Breadcrumb,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Where a page sits and the way back up. Official MIT source. [Usage reference](https://www.affectui.com/components/breadcrumb) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/breadcrumb-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    'aria-label': 'Project breadcrumb',
    items: [
      { label: 'Projects', onClick: fn() },
      { label: 'Factory', onClick: fn() },
      { label: 'Components' },
    ],
  },
} satisfies Meta<typeof Breadcrumb>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicBreadcrumb {...args} /> };
