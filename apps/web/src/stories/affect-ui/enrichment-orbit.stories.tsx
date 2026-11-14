import type { Meta, StoryObj } from '@storybook/react-vite';
import { EnrichmentOrbit } from '@factory/affect-ui/illustrations/enrichment-orbit';

const meta = {
  title: 'affectUI/Illustrations/Enrichment Orbit',
  component: EnrichmentOrbit,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Grok tile inside two rings with comets and data nodes orbiting around it. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/enrichment-orbit) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/enrichment-orbit.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'Data sources orbiting a sample profile' },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <EnrichmentOrbit {...args} />
    </div>
  ),
} satisfies Meta<typeof EnrichmentOrbit>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
