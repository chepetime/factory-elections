import type { Meta, StoryObj } from '@storybook/react-vite';
import { MessageActions } from '@factory/affect-ui/components/message-actions-clean';
import { MessageActions as ClassicMessageActions } from '@factory/affect-ui/components/message-actions';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Message Actions',
  component: MessageActions,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The quiet bar under an AI message. Official MIT source. [Usage reference](https://www.affectui.com/components/message-actions) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/message-actions-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    text: 'The project checks passed. Two review notes remain.',
    versions: 3,
    onCopy: fn(),
    onRegenerate: fn(),
    onFeedback: fn(),
    onSpeak: fn(),
  },
} satisfies Meta<typeof MessageActions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicMessageActions {...args} /> };
