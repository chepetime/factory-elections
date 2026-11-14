import type { Meta, StoryObj } from '@storybook/react-vite';
import { GlowCloud } from '@factory/affect-ui/illustrations/glow-cloud';

const meta = {
  title: 'affectUI/Illustrations/Glow Cloud',
  component: GlowCloud,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A glowing cloud with eyes in red-orange or blue. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/glow-cloud) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/glow-cloud.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'Glowing blue cloud illustration', followPointer: true },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <GlowCloud {...args} />
    </div>
  ),
} satisfies Meta<typeof GlowCloud>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
