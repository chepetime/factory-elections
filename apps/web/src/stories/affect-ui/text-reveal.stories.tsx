import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextReveal } from '@factory/affect-ui/motion/text-reveal';

const meta = {
  title: 'affectUI/Motion/Text Reveal',
  component: TextReveal,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Text that arrives word by word or letter by letter. Official MIT source. [Usage reference](https://www.affectui.com/motion/text-reveal) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/motion/text-reveal.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { text: 'A clearer view of work in motion.', by: 'word', className: 'text-3xl font-semibold' },
} satisfies Meta<typeof TextReveal>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
