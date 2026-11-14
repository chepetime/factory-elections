import type { Meta, StoryObj } from '@storybook/react-vite';
import { ModelWheel } from '@factory/affect-ui/illustrations/model-wheel';

const meta = {
  title: 'affectUI/Illustrations/Model Wheel',
  component: ModelWheel,
  tags: ['autodocs'],
  parameters: {
    // The drum is decorative (upstream aria-hidden="true"); its fading labels are
    // artwork, while the root image supplies a complete accessible description.
    a11y: { context: { exclude: [['.ui-mw-drum']] } },
    docs: {
      description: {
        component:
          'AI model names on a turning drum. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/model-wheel) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/model-wheel.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'A wheel of model choices' },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <ModelWheel {...args} />
    </div>
  ),
} satisfies Meta<typeof ModelWheel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
