import type { Meta, StoryObj } from '@storybook/react-vite';
import { Kbd } from '@factory/affect-ui/components/kbd-clean';
import { Kbd as ClassicKbd } from '@factory/affect-ui/components/kbd';

const meta = {
  title: 'affectUI/Components/Kbd',
  component: Kbd,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A key chip for shortcuts. Official MIT source. [Usage reference](https://www.affectui.com/components/kbd) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/kbd-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { keys: ['mod', 'K'] },
} satisfies Meta<typeof Kbd>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicKbd {...args} /> };
