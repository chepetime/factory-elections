import type { Meta, StoryObj } from '@storybook/react-vite';
import { TeamInvite } from '@factory/affect-ui/illustrations/team-invite';
import { sampleImage } from './story-fixtures';

const meta = {
  title: 'affectUI/Illustrations/Team Invite',
  component: TeamInvite,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Connected teammates. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/team-invite) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/team-invite.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    label: 'Inviting a third teammate',
    avatars: [
      { name: 'Alex Rivera', src: sampleImage('AR') },
      { name: 'Morgan Lee', src: sampleImage('ML', '#7c3aed') },
      { name: 'Sam Chen', src: sampleImage('SC', '#15803d') },
    ],
  },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <TeamInvite {...args} />
    </div>
  ),
} satisfies Meta<typeof TeamInvite>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
