import type { Meta, StoryObj } from '@storybook/react-vite';
import { GridBackground } from '@factory/affect-ui/motion/grid-background';

const meta = {
  title: 'affectUI/Motion/Grid Background',
  component: GridBackground,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A fine line grid that drifts slowly behind your content and fades out towards the edges. Official MIT source. [Usage reference](https://www.affectui.com/motion/grid-background) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/motion/grid-background.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    className: 'h-72 rounded-xl',
    children: (
      <div className="flex h-72 items-center justify-center">
        <p className="rounded-lg bg-background/90 px-5 py-3 text-lg font-medium">Work in motion</p>
      </div>
    ),
  },
} satisfies Meta<typeof GridBackground>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
