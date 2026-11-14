import type { Meta, StoryObj } from '@storybook/react-vite';
import { GhostedChat } from '@factory/affect-ui/illustrations/ghosted-chat';

const meta = {
  title: 'affectUI/Illustrations/Ghosted Chat',
  component: GhostedChat,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Unanswered chat messages marked as read, with a thumbs-down reply on hover. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/ghosted-chat) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/ghosted-chat.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'A sample chat waiting for a reply' },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <GhostedChat {...args} />
    </div>
  ),
} satisfies Meta<typeof GhostedChat>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
