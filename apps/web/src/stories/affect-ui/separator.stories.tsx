import type { Meta, StoryObj } from '@storybook/react-vite';
import { Separator } from '@factory/affect-ui/components/separator-clean';
import { Separator as ClassicSeparator } from '@factory/affect-ui/components/separator';

const meta = {
  title: 'affectUI/Components/Separator',
  component: Separator,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A thin line between groups. Official MIT source. [Usage reference](https://www.affectui.com/components/separator) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/separator-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'Earlier' },
} satisfies Meta<typeof Separator>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicSeparator {...args} /> };
