import type { Meta, StoryObj } from '@storybook/react-vite';
import { IntegrationBeam } from '@factory/affect-ui/illustrations/integration-beam';
import { Settings, Check, Folder, ScanSearch } from 'lucide-react';

const meta = {
  title: 'affectUI/Illustrations/Integration Beam',
  component: IntegrationBeam,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Your product between the tools it connects. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/integration-beam) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/integration-beam.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    label: 'Sample project integrations',
    left: [
      { name: 'Projects', logo: <Folder aria-hidden="true" /> },
      { name: 'Checks', logo: <Check aria-hidden="true" /> },
    ],
    right: [
      { name: 'Reviews', logo: <ScanSearch aria-hidden="true" /> },
      { name: 'Settings', logo: <Settings aria-hidden="true" /> },
    ],
    center: { name: 'Factory', logo: <span aria-hidden="true">F</span> },
  },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <IntegrationBeam {...args} />
    </div>
  ),
} satisfies Meta<typeof IntegrationBeam>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
