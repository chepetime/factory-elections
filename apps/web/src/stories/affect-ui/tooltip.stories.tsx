import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tooltip } from '@factory/affect-ui/components/tooltip-clean';
import { Tooltip as ClassicTooltip } from '@factory/affect-ui/components/tooltip';

const meta = {
  title: 'affectUI/Components/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A small dark label for one control. Official MIT source. [Usage reference](https://www.affectui.com/components/tooltip) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/tooltip-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    content: 'Open project settings',
    shortcut: '⌘,',
    children: (
      <button type="button" className="min-h-11 rounded-lg border px-4">
        Settings
      </button>
    ),
  },
} satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicTooltip {...args} /> };
