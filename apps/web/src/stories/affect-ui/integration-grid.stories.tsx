import type { Meta, StoryObj } from '@storybook/react-vite';
import { IntegrationGrid } from '@factory/affect-ui/illustrations/integration-grid';

const meta = {
  title: 'affectUI/Illustrations/Integration Grid',
  component: IntegrationGrid,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Honeycomb-like wall of integration logos around a bright centre tile with your product mark, fading out toward the edges. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/integration-grid) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/integration-grid.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'A grid of connected tools', columns: 5 },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <IntegrationGrid {...args} />
    </div>
  ),
} satisfies Meta<typeof IntegrationGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
