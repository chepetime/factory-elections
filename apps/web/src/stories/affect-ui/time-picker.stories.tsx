import type { Meta, StoryObj } from '@storybook/react-vite';
import { TimePicker } from '@factory/affect-ui/components/time-picker-clean';
import { TimePicker as ClassicTimePicker } from '@factory/affect-ui/components/time-picker';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Time Picker',
  component: TimePicker,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A time of day you type or pick. Official MIT source. [Usage reference](https://www.affectui.com/components/time-picker) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/time-picker-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'Review time', defaultValue: '09:30', hourCycle: 24, locale: 'en-US', onChange: fn() },
} satisfies Meta<typeof TimePicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicTimePicker {...args} /> };
