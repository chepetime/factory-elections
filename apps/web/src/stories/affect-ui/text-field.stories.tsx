import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextField } from '@factory/affect-ui/components/text-field-clean';
import { TextField as ClassicTextField } from '@factory/affect-ui/components/text-field';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Text Field',
  component: TextField,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'One input for every form. Official MIT source. [Usage reference](https://www.affectui.com/components/text-field) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/text-field-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    label: 'Project name',
    defaultValue: 'Software Factory',
    hint: 'A name for your local workspace.',
    clearable: true,
    onChange: fn(),
    onClear: fn(),
  },
} satisfies Meta<typeof TextField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicTextField {...args} /> };
