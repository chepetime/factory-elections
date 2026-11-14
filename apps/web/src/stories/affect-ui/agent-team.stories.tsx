import type { Meta, StoryObj } from '@storybook/react-vite';
import { AgentTeam } from '@factory/affect-ui/illustrations/agent-team';
import { sampleImage } from './story-fixtures';

const meta = {
  title: 'affectUI/Illustrations/Agent Team',
  component: AgentTeam,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A prompt types itself and branches out into three agents, each with a role and overlapping tool logos. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/agent-team) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/agent-team.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    prompt: 'Prepare a sample project review',
    members: [
      { role: 'Researcher', avatar: sampleImage('AR'), tools: ['slack'] },
      { role: 'Reviewer', avatar: sampleImage('ML', '#7c3aed'), tools: ['gmail'] },
      { role: 'Coordinator', avatar: sampleImage('SC', '#15803d'), tools: ['hubspot'] },
    ],
  },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <AgentTeam {...args} />
    </div>
  ),
} satisfies Meta<typeof AgentTeam>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
