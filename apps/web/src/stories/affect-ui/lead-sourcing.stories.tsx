import type { Meta, StoryObj } from '@storybook/react-vite';
import { LeadSourcing } from '@factory/affect-ui/illustrations/lead-sourcing';

const meta = {
  title: 'affectUI/Illustrations/Lead Sourcing',
  component: LeadSourcing,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'ChatGPT tile linked to Gmail and Grok, with a shine running along the connection. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/lead-sourcing) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/lead-sourcing.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'A sample lead sourcing scene' },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <LeadSourcing {...args} />
    </div>
  ),
} satisfies Meta<typeof LeadSourcing>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
