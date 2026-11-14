import type { Meta, StoryObj } from '@storybook/react-vite';
import { LayerStack } from '@factory/affect-ui/illustrations/layer-stack';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Illustrations/Layer Stack',
  component: LayerStack,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Isometric stack of five layers with a list beside it. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/layer-stack) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/layer-stack.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    items: [
      { title: 'Repository context', hint: 'Files', icon: 'database' },
      { title: 'Verification tools', hint: 'Checks', icon: 'plug' },
      { title: 'Review results', hint: 'Findings', icon: 'spark' },
    ],
    onChange: fn(),
  },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <LayerStack {...args} />
    </div>
  ),
} satisfies Meta<typeof LayerStack>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
