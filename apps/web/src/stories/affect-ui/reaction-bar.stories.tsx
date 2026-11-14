import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReactionBar } from '@factory/affect-ui/components/reaction-bar-clean';
import { ReactionBar as ClassicReactionBar } from '@factory/affect-ui/components/reaction-bar';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Reaction Bar',
  component: ReactionBar,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Like, comment, repost and share in one pill. Official MIT source. [Usage reference](https://www.affectui.com/components/reaction-bar) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/reaction-bar-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    reactions: { like: { count: 12 }, comment: { count: 3 }, repost: { count: 1 }, share: { count: 0 } },
    onReact: fn(),
  },
} satisfies Meta<typeof ReactionBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicReactionBar {...args} /> };
