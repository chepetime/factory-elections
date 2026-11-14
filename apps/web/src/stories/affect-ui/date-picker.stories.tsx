import type { Meta, StoryObj } from '@storybook/react-vite';
import { DatePicker } from '@factory/affect-ui/components/date-picker-clean';
import { DatePicker as ClassicDatePicker } from '@factory/affect-ui/components/date-picker';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Date Picker',
  component: DatePicker,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          "Pick one day in the Text Field's look. Official MIT source. [Usage reference](https://www.affectui.com/components/date-picker) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/date-picker-clean.tsx). Sample actions only log to Storybook.",
      },
    },
  },
  args: {
    label: 'Review date',
    defaultValue: new Date(2026, 10, 13),
    today: new Date(2026, 10, 13),
    locale: 'en-US',
    onChange: fn(),
  },
} satisfies Meta<typeof DatePicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicDatePicker {...args} /> };
