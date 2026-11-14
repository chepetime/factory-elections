import type { Meta, StoryObj } from '@storybook/react-vite';
import { TagInput } from '@factory/affect-ui/components/tag-input-clean';
import { TagInput as ClassicTagInput } from '@factory/affect-ui/components/tag-input';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Tag Input',
  component: TagInput,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Several values in one field as chips. Official MIT source. [Usage reference](https://www.affectui.com/components/tag-input) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/tag-input-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    label: 'Task labels',
    defaultValue: ['frontend', 'review'],
    hint: 'Type a label and press Enter.',
    onChange: fn(),
  },
} satisfies Meta<typeof TagInput>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicTagInput {...args} /> };
