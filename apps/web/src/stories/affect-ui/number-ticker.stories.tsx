import type { Meta, StoryObj } from '@storybook/react-vite';
import { NumberTicker } from '@factory/affect-ui/motion/number-ticker';

const meta = {
  title: 'affectUI/Motion/Number Ticker',
  component: NumberTicker,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Odometer-style numbers. Official MIT source. [Usage reference](https://www.affectui.com/motion/number-ticker) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/motion/number-ticker.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    value: 12480,
    locale: 'en-US',
    format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
    className: 'text-4xl font-semibold',
  },
} satisfies Meta<typeof NumberTicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
