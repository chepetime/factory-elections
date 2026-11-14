import type { Meta, StoryObj } from '@storybook/react-vite';
import { CoverFlow } from '@factory/affect-ui/illustrations/cover-flow';
import { fn } from 'storybook/test';
import { sampleImage } from './story-fixtures';

const meta = {
  title: 'affectUI/Illustrations/Cover Flow',
  component: CoverFlow,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Browse covers in 3D. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/cover-flow) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/cover-flow.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    'aria-label': 'Sample project covers',
    items: [
      { id: 'review', title: 'Review', image: sampleImage('Review'), alt: 'Blue review cover' },
      { id: 'build', title: 'Build', image: sampleImage('Build', '#7c3aed'), alt: 'Purple build cover' },
      {
        id: 'verify',
        title: 'Verify',
        image: sampleImage('Verify', '#15803d'),
        alt: 'Green verification cover',
      },
    ],
    controls: true,
    sound: false,
    onSelect: fn(),
    onIndexChange: fn(),
  },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <CoverFlow {...args} />
    </div>
  ),
} satisfies Meta<typeof CoverFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
