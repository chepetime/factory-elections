import type { Meta, StoryObj } from '@storybook/react-vite';
import { LogoCluster } from '@factory/affect-ui/illustrations/logo-cluster';

const meta = {
  title: 'affectUI/Illustrations/Logo Cluster',
  component: LogoCluster,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Your mark on a white disc in the middle. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/logo-cluster) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/logo-cluster.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'A cluster of app integrations' },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <LogoCluster {...args} />
    </div>
  ),
} satisfies Meta<typeof LogoCluster>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
