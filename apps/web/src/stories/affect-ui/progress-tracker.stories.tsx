import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProgressTracker } from '@factory/affect-ui/components/progress-tracker-clean';
import { ProgressTracker as ClassicProgressTracker } from '@factory/affect-ui/components/progress-tracker';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Progress Tracker',
  component: ProgressTracker,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Onboarding checklist with an animated progress bar, ticks that draw themselves and auto play. Official MIT source. [Usage reference](https://www.affectui.com/components/progress-tracker) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/progress-tracker-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    title: 'Set up the factory',
    autoPlay: false,
    steps: [
      { id: 'project', label: 'Choose a project', done: true },
      { id: 'checks', label: 'Configure verification' },
      { id: 'run', label: 'Run a sample task' },
    ],
    onChange: fn(),
  },
} satisfies Meta<typeof ProgressTracker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicProgressTracker {...args} /> };
