import type { Meta, StoryObj } from '@storybook/react-vite';
import { Spinner } from '@factory/affect-ui/components/spinner-clean';
import { Spinner as ClassicSpinner } from '@factory/affect-ui/components/spinner';

const meta = {
  title: 'affectUI/Components/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A small turning arc for work that runs right now. Official MIT source. [Usage reference](https://www.affectui.com/components/spinner) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/spinner-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'Running sample checks', size: 24 },
} satisfies Meta<typeof Spinner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicSpinner {...args} /> };
