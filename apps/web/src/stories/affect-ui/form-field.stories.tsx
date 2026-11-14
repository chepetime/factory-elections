import type { Meta, StoryObj } from '@storybook/react-vite';
import { FormField } from '@factory/affect-ui/components/form-field-clean';
import { FormField as ClassicFormField } from '@factory/affect-ui/components/form-field';

const meta = {
  title: 'affectUI/Components/Form Field',
  component: FormField,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The frame around any control. Official MIT source. [Usage reference](https://www.affectui.com/components/form-field) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/form-field-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    label: 'Project name',
    hint: 'Use a short, recognizable name.',
    required: true,
    children: ({ id, labelId: _labelId, ...control }) => (
      <input
        {...control}
        id={id}
        defaultValue="Software Factory"
        className="min-h-11 w-full rounded-lg border bg-background px-3 text-base"
      />
    ),
  },
} satisfies Meta<typeof FormField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicFormField {...args} /> };
