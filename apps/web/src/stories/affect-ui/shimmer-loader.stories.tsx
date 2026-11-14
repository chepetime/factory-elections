import type { Meta, StoryObj } from '@storybook/react-vite';
import { Skeleton, ShimmerText } from '@factory/affect-ui/motion/shimmer-loader';

const meta = {
  title: 'affectUI/Motion/Shimmer Loader',
  component: Skeleton,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Skeleton blocks that share one soft light sweep, plus shimmering text for \u201cThinking\u2026\u201d states. Official MIT source. [Usage reference](https://www.affectui.com/motion/shimmer-loader) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/motion/shimmer-loader.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { width: '75%', height: 16 },
  render: (args) => (
    <div className="space-y-4">
      <ShimmerText>Preparing sample results…</ShimmerText>
      <Skeleton {...args} />
      <Skeleton {...args} width="55%" />
    </div>
  ),
} satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
