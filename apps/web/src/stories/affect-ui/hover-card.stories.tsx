import type { Meta, StoryObj } from '@storybook/react-vite';
import { HoverCard } from '@factory/affect-ui/components/hover-card-clean';
import { HoverCard as ClassicHoverCard } from '@factory/affect-ui/components/hover-card';

const meta = {
  title: 'affectUI/Components/Hover Card',
  component: HoverCard,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A preview of what a link or name points to. Official MIT source. [Usage reference](https://www.affectui.com/components/hover-card) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/hover-card-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    content: (
      <div className="space-y-1">
        <p className="font-medium">Factory project</p>
        <p className="text-sm">12 tasks reviewed this week.</p>
      </div>
    ),
    children: (
      <button type="button" className="min-h-11 rounded-lg border px-4">
        Preview project
      </button>
    ),
  },
} satisfies Meta<typeof HoverCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicHoverCard {...args} /> };
