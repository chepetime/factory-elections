import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmptyState } from '@factory/affect-ui/components/empty-state-clean';
import { EmptyState as ClassicEmptyState } from '@factory/affect-ui/components/empty-state';

const meta = {
  title: 'affectUI/Components/Empty State',
  component: EmptyState,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'What a list, table or panel shows while it has nothing yet. Official MIT source. [Usage reference](https://www.affectui.com/components/empty-state) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/empty-state-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    title: 'No tasks yet',
    text: 'Create a task to start the first run.',
    action: (
      <button type="button" className="min-h-11 rounded-lg border px-4">
        Create sample task
      </button>
    ),
  },
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicEmptyState {...args} /> };
