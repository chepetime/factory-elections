import type { Meta, StoryObj } from '@storybook/react-vite';
import { FrostCloud } from '@factory/affect-ui/illustrations/frost-cloud';

const meta = {
  title: 'affectUI/Illustrations/Frost Cloud',
  component: FrostCloud,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A frosted white cloud with eyes cut out of it, on a blue or red-orange sky. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/frost-cloud) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/frost-cloud.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'Frosted blue cloud illustration', followPointer: true },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <FrostCloud {...args} />
    </div>
  ),
} satisfies Meta<typeof FrostCloud>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
