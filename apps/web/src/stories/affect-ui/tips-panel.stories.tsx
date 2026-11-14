import type { Meta, StoryObj } from '@storybook/react-vite';
import { TipsPanel } from '@factory/affect-ui/components/tips-panel-clean';
import { TipsPanel as ClassicTipsPanel } from '@factory/affect-ui/components/tips-panel';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Tips Panel',
  component: TipsPanel,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Grid of short tips with one action each. Official MIT source. [Usage reference](https://www.affectui.com/components/tips-panel) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/tips-panel-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    title: 'Get more from the factory',
    tips: [
      {
        id: 'checks',
        title: 'Set verification commands',
        description: 'Give every run a repeatable set of checks.',
        action: 'Configure checks',
        doneLabel: 'Configured',
        onAction: fn(),
      },
      {
        id: 'context',
        title: 'Add project context',
        description: 'Help the reviewer understand the repository.',
        action: 'Add context',
        onAction: fn(),
      },
    ],
    onClose: fn(),
  },
} satisfies Meta<typeof TipsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicTipsPanel {...args} /> };
