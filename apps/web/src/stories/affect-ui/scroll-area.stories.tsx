import type { Meta, StoryObj } from '@storybook/react-vite';
import { ScrollArea } from '@factory/affect-ui/components/scroll-area-clean';
import { ScrollArea as ClassicScrollArea } from '@factory/affect-ui/components/scroll-area';

const meta = {
  title: 'affectUI/Components/Scroll Area',
  component: ScrollArea,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          "A box that scrolls the browser's own way with a slim scrollbar of its own. Official MIT source. [Usage reference](https://www.affectui.com/components/scroll-area) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/scroll-area-clean.tsx). Sample actions only log to Storybook.",
      },
    },
  },
  args: {
    'aria-label': 'Sample task list',
    maxHeight: 240,
    type: 'always',
    children: (
      <ol className="space-y-3 p-4">
        {Array.from({ length: 18 }, (_, index) => (
          <li key={`task-${index}`} className="rounded-lg border p-3">
            Review task {index + 1}
          </li>
        ))}
      </ol>
    ),
  },
} satisfies Meta<typeof ScrollArea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicScrollArea {...args} /> };
