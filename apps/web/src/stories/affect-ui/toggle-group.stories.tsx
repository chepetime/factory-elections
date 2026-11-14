import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToggleGroup } from '@factory/affect-ui/components/toggle-group-clean';
import { ToggleGroup as ClassicToggleGroup } from '@factory/affect-ui/components/toggle-group';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Toggle Group',
  component: ToggleGroup,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A row of toggle buttons. Official MIT source. [Usage reference](https://www.affectui.com/components/toggle-group) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/toggle-group-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    'aria-label': 'Review checks',
    type: 'multiple',
    defaultValue: ['types'],
    items: [
      { value: 'types', label: 'Types' },
      { value: 'tests', label: 'Tests' },
      { value: 'lint', label: 'Lint' },
    ],
    onChange: fn(),
  },
} satisfies Meta<typeof ToggleGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicToggleGroup {...args} /> };
