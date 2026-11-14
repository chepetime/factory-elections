import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommentThread } from '@factory/affect-ui/components/comment-thread-clean';
import { CommentThread as ClassicCommentThread } from '@factory/affect-ui/components/comment-thread';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Comment Thread',
  component: CommentThread,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'One comment with replies. Official MIT source. [Usage reference](https://www.affectui.com/components/comment-thread) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/comment-thread-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    title: 'Review notes',
    currentUser: { name: 'Alex Rivera' },
    assistant: { name: 'Factory assistant', assistant: true },
    messages: [
      {
        id: 'note',
        author: { name: 'Factory assistant', assistant: true },
        createdAt: new Date('2026-11-13T12:00:00Z'),
        text: 'The quick checks passed. The retry path still needs a regression test.',
        status: 'Reviewed two files',
        details: ['Checked task transitions', 'Inspected the retry handler'],
      },
    ],
    onReply: fn(),
  },
} satisfies Meta<typeof CommentThread>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicCommentThread {...args} /> };
