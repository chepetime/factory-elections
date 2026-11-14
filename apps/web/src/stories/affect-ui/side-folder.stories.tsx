import type { Meta, StoryObj } from '@storybook/react-vite';
import { SideFolder } from '@factory/affect-ui/illustrations/side-folder';

const meta = {
  title: 'affectUI/Illustrations/Side Folder',
  component: SideFolder,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Glassy blue folder on its side, documents sliding out to the right as the pocket swings open on hover. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/side-folder) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/side-folder.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: { label: 'A folder holding sample project documents' },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <SideFolder {...args} />
    </div>
  ),
} satisfies Meta<typeof SideFolder>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
