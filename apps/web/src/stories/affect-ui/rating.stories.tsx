import type { Meta, StoryObj } from '@storybook/react-vite';
import { Rating } from '@factory/affect-ui/components/rating-clean';
import { Rating as ClassicRating } from '@factory/affect-ui/components/rating';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Rating',
  component: Rating,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Stars or thumbs up and down for an AI answer. Official MIT source. [Usage reference](https://www.affectui.com/components/rating) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/rating-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { 'aria-label': 'Rate the sample review', defaultValue: 3, max: 5, onValueChange: fn() },
} satisfies Meta<typeof Rating>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicRating {...args} /> };
