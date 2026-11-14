import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmptyCalendar } from '@factory/affect-ui/illustrations/empty-calendar';

const meta = {
  title: 'affectUI/Illustrations/Empty Calendar',
  component: EmptyCalendar,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Stack of calendar cards marked empty, fanning out on hover. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/empty-calendar) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/empty-calendar.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'An empty calendar ready for a new review' },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <EmptyCalendar {...args} />
    </div>
  ),
} satisfies Meta<typeof EmptyCalendar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
