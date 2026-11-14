import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@factory/affect-ui/components/resizable-clean';
import {
  ResizablePanelGroup as ClassicResizablePanelGroup,
  ResizablePanel as ClassicResizablePanel,
  ResizableHandle as ClassicResizableHandle,
} from '@factory/affect-ui/components/resizable';
import { fn } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Resizable',
  component: ResizablePanelGroup,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Panes side by side or stacked with a line between them you can drag. Official MIT source. [Usage reference](https://www.affectui.com/components/resizable) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/resizable-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    'aria-label': 'Project workspace',
    children: (
      <>
        <ResizablePanel defaultSize={35} minSize={20}>
          <div className="flex h-52 items-center justify-center bg-muted">Project list</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize project panels" withHandle />
        <ResizablePanel defaultSize={65} minSize={30}>
          <div className="flex h-52 items-center justify-center">Task details</div>
        </ResizablePanel>
      </>
    ),
    onLayout: fn(),
  },
} satisfies Meta<typeof ResizablePanelGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = {
  render: (args) => (
    <ClassicResizablePanelGroup {...args}>
      <ClassicResizablePanel defaultSize={35} minSize={20}>
        <div className="flex h-52 items-center justify-center bg-muted">Project list</div>
      </ClassicResizablePanel>
      <ClassicResizableHandle aria-label="Resize project panels" withHandle />
      <ClassicResizablePanel defaultSize={65} minSize={30}>
        <div className="flex h-52 items-center justify-center">Task details</div>
      </ClassicResizablePanel>
    </ClassicResizablePanelGroup>
  ),
};
