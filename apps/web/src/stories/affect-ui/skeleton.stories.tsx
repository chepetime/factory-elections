import type { Meta, StoryObj } from '@storybook/react-vite';
import { Skeleton } from '@factory/affect-ui/components/skeleton-clean';
import { Skeleton as ClassicSkeleton } from '@factory/affect-ui/components/skeleton';

const meta = {
  title: 'affectUI/Components/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Gray shapes in the exact size of the content they stand in for. Official MIT source. [Usage reference](https://www.affectui.com/components/skeleton) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/skeleton-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { width: '75%', height: 20, 'aria-label': 'Loading sample content' },
} satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicSkeleton {...args} /> };
