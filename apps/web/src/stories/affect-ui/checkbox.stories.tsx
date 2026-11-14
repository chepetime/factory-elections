import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from '@factory/affect-ui/components/checkbox-clean';
import { Checkbox as ClassicCheckbox } from '@factory/affect-ui/components/checkbox';
import { expect, fn, userEvent, within } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A real checkbox with a label and a second line, a some-of-them state for Select all, an error and a card row. Official MIT source. [Usage reference](https://www.affectui.com/components/checkbox) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/checkbox-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const checkbox = canvas.getByRole('checkbox', { name: /Run verification before review/ });
    await expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);
    await expect(checkbox).not.toBeChecked();
  },
  args: {
    label: 'Run verification before review',
    description: 'Check types and tests for this project.',
    defaultChecked: true,
    onChange: fn(),
  },
} satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicCheckbox {...args} /> };
