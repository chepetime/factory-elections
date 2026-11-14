import type { Meta, StoryObj } from '@storybook/react-vite';
import { RegionDach } from '@factory/affect-ui/illustrations/region-dach';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Illustrations/DACH Region',
  component: RegionDach,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'DACH map with fading neighbours and a pastel band along the border, switchable to the US, China, India, Brazil or Japan. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/region-dach) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/region-dach.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { defaultRegion: 'dach', showSwitcher: true, onRegionChange: fn() },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <RegionDach {...args} />
    </div>
  ),
} satisfies Meta<typeof RegionDach>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
