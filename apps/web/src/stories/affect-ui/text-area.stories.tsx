import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextArea } from '@factory/affect-ui/components/text-area-clean';
import { TextArea as ClassicTextArea } from '@factory/affect-ui/components/text-area';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Text Area',
  component: TextArea,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The multi-line twin of the Text Field. Official MIT source. [Usage reference](https://www.affectui.com/components/text-area) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/text-area-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    label: 'Task instructions',
    defaultValue: 'Review the retry flow and preserve the previous attempt.',
    hint: 'Describe the expected behavior.',
    counter: true,
    maxLength: 240,
    expandable: true,
    onChange: fn(),
    onSubmitShortcut: fn(),
  },
} satisfies Meta<typeof TextArea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicTextArea {...args} /> };
