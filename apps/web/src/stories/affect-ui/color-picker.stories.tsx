import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColorPicker } from '@factory/affect-ui/components/color-picker-clean';
import { ColorPicker as ClassicColorPicker } from '@factory/affect-ui/components/color-picker';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Color Picker',
  component: ColorPicker,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A swatch button that opens a color card. Official MIT source. [Usage reference](https://www.affectui.com/components/color-picker) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/color-picker-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    label: 'Agent color',
    defaultValue: '#2563eb',
    showValue: true,
    presets: ['#2563eb', '#7c3aed', '#15803d'],
    onValueChange: fn(),
  },
} satisfies Meta<typeof ColorPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicColorPicker {...args} /> };
