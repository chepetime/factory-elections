import type { Meta, StoryObj } from '@storybook/react-vite';
import { TabOverload } from '@factory/affect-ui/illustrations/tab-overload';

const meta = {
  title: 'affectUI/Illustrations/Tab Overload',
  component: TabOverload,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Overlapping browser windows where the highlight follows the hovered tab. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/tab-overload) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/tab-overload.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'Several stacked sample browser windows' },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <TabOverload {...args} />
    </div>
  ),
} satisfies Meta<typeof TabOverload>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
