import type { Meta, StoryObj } from '@storybook/react-vite';
import { FilterMenu } from '@factory/affect-ui/components/filter-menu-clean';
import { FilterMenu as ClassicFilterMenu } from '@factory/affect-ui/components/filter-menu';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Filter Menu',
  component: FilterMenu,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Grouped filters with removable chips, collapsible checkbox groups, Clear all and full keyboard control. Official MIT source. [Usage reference](https://www.affectui.com/components/filter-menu) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/filter-menu-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    title: 'Filter tasks',
    groups: [
      {
        id: 'status',
        label: 'Status',
        options: [
          { id: 'running', label: 'Running' },
          { id: 'done', label: 'Completed' },
          { id: 'failed', label: 'Failed' },
        ],
      },
      {
        id: 'owner',
        label: 'Owner',
        options: [
          { id: 'alex', label: 'Alex' },
          { id: 'morgan', label: 'Morgan' },
        ],
      },
    ],
    defaultValue: { status: ['running'] },
    onChange: fn(),
  },
} satisfies Meta<typeof FilterMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicFilterMenu {...args} /> };
