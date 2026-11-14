import type { Meta, StoryObj } from '@storybook/react-vite';
import { Select } from '@factory/affect-ui/components/select-clean';
import { Select as ClassicSelect } from '@factory/affect-ui/components/select';
import { expect, fn, userEvent, within } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Select',
  component: Select,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          "Pick one option in the Text Field's look. Official MIT source. [Usage reference](https://www.affectui.com/components/select) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/select-clean.tsx). Sample actions only log to Storybook.",
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('combobox', { name: 'Review model' }));
    await userEvent.click(canvas.getByRole('option', { name: /Thorough review/ }));
    await expect(args.onChange).toHaveBeenCalledWith(
      'thorough',
      expect.objectContaining({ value: 'thorough' }),
    );
  },
  args: {
    label: 'Review model',
    placeholder: 'Choose a model',
    options: [
      { value: 'fast', label: 'Fast review', description: 'Quick checks and a short summary' },
      { value: 'thorough', label: 'Thorough review', description: 'More context and deeper verification' },
      { value: 'legacy', label: 'Legacy model', disabled: true },
    ],
    defaultValue: 'fast',
    onChange: fn(),
  },
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicSelect {...args} /> };
