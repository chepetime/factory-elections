import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThinkingLoader } from '@factory/affect-ui/components/thinking-loader-clean';
import { ThinkingLoader as ClassicThinkingLoader } from '@factory/affect-ui/components/thinking-loader';

const meta = {
  title: 'affectUI/Components/Thinking Loader',
  component: ThinkingLoader,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A small working pill for AI replies. Official MIT source. [Usage reference](https://www.affectui.com/components/thinking-loader) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/thinking-loader-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { phases: ['Reading the brief', 'Inspecting the repository', 'Preparing findings'], phase: 1 },
} satisfies Meta<typeof ThinkingLoader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicThinkingLoader {...args} /> };
