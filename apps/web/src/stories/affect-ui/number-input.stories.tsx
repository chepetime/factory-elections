import type { Meta, StoryObj } from '@storybook/react-vite';
import { NumberInput } from '@factory/affect-ui/components/number-input-clean';
import { NumberInput as ClassicNumberInput } from '@factory/affect-ui/components/number-input';
import { expect, fn, userEvent, within } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Number Input',
  component: NumberInput,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A field for one number. Official MIT source. [Usage reference](https://www.affectui.com/components/number-input) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/number-input-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Increase' }));
    await expect(args.onValueChange).toHaveBeenCalledWith(5000);
  },
  args: {
    label: 'Token budget',
    defaultValue: 4000,
    min: 1000,
    max: 12000,
    step: 1000,
    unit: 'tokens',
    onValueChange: fn(),
  },
} satisfies Meta<typeof NumberInput>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicNumberInput {...args} /> };
