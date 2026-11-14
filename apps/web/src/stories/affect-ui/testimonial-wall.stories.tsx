import type { Meta, StoryObj } from '@storybook/react-vite';
import { TestimonialWall } from '@factory/affect-ui/blocks/testimonial-wall-clean';
import { TestimonialWall as ClassicTestimonialWall } from '@factory/affect-ui/blocks/testimonial-wall';

const meta = {
  title: 'affectUI/Blocks/Testimonial Wall',
  component: TestimonialWall,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The landing-page wall of quotes. Official MIT source. [Usage reference](https://www.affectui.com/blocks/testimonial-wall) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/blocks/testimonial-wall-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    label: 'Fictional feedback for the component preview',
    columns: 2,
    items: [
      {
        name: 'Alex Rivera',
        role: 'Engineer',
        company: 'Example team',
        quote: 'A clear view of every saved attempt makes a review easier to follow.',
      },
      {
        name: 'Morgan Lee',
        role: 'Designer',
        company: 'Example studio',
        quote: 'The small details make complex agent work feel manageable.',
      },
      {
        name: 'Sam Chen',
        role: 'Developer',
        company: 'Example project',
        quote: 'The component previews help us agree on behavior before integration.',
      },
    ],
  },
} satisfies Meta<typeof TestimonialWall>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicTestimonialWall {...args} /> };
