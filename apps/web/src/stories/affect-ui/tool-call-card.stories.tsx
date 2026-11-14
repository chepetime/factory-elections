import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToolCallCard } from '@factory/affect-ui/components/tool-call-card-clean';
import { ToolCallCard as ClassicToolCallCard } from '@factory/affect-ui/components/tool-call-card';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Tool Call Card',
  component: ToolCallCard,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          "An agent's tool call in one line. Official MIT source. [Usage reference](https://www.affectui.com/components/tool-call-card) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/tool-call-card-clean.tsx). Sample actions only log to Storybook.",
      },
    },
  },
  args: {
    name: 'read_file',
    summary: 'Read the task handler',
    status: 'success',
    args: { path: 'src/tasks.ts' },
    result: { lines: 128, status: 'read' },
    duration: 240,
    defaultOpen: true,
    onRetry: fn(),
  },
} satisfies Meta<typeof ToolCallCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicToolCallCard {...args} /> };
