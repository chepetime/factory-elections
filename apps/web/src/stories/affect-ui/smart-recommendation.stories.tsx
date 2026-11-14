import type { Meta, StoryObj } from '@storybook/react-vite';
import { SmartRecommendation } from '@factory/affect-ui/components/smart-recommendation-clean';
import { SmartRecommendation as ClassicSmartRecommendation } from '@factory/affect-ui/components/smart-recommendation';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Smart Recommendation',
  component: SmartRecommendation,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Suggestion card with a confidence signal, alternatives to switch to and accept with undo. Official MIT source. [Usage reference](https://www.affectui.com/components/smart-recommendation) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/smart-recommendation-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    title: 'Suggested next step',
    options: [
      {
        id: 'test',
        label: 'Add retry coverage',
        reason: 'The failed-task retry path has no regression test.',
        signal: 3,
      },
      {
        id: 'docs',
        label: 'Update the runbook',
        reason: 'Document the checks after the behavior is covered.',
        signal: 1,
      },
    ],
    onAccept: fn(),
    onUndo: fn(),
  },
} satisfies Meta<typeof SmartRecommendation>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicSmartRecommendation {...args} /> };
