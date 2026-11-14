import type { Meta, StoryObj } from '@storybook/react-vite';
import { Popover } from '@factory/affect-ui/components/popover-clean';
import { Popover as ClassicPopover } from '@factory/affect-ui/components/popover';
import { fn } from 'storybook/test';
import { useState, useRef, type ComponentProps } from 'react';

const meta = {
  title: 'affectUI/Components/Popover',
  component: Popover,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A small floating card attached to its trigger. Official MIT source. [Usage reference](https://www.affectui.com/components/popover) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/popover-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    open: false,
    title: 'Run details',
    description: 'A sample checkpoint.',
    children: <p className="text-sm">Three files changed and all quick checks passed.</p>,
    onClose: fn(),
  },
  render: (args) => <PopoverPreview key={String(args.open)} {...args} />,
} satisfies Meta<typeof Popover>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = {
  render: (args) => <PopoverPreview key={String(args.open)} {...args} classic />,
};

function PopoverPreview({
  classic = false,
  ...args
}: ComponentProps<typeof Popover> & { classic?: boolean }) {
  const [open, setOpen] = useState(args.open);
  const anchor = useRef<HTMLButtonElement>(null);
  const Component = classic ? ClassicPopover : Popover;
  return (
    <div className="min-h-48">
      <button
        ref={anchor}
        type="button"
        className="min-h-11 rounded-lg border px-4"
        onClick={() => setOpen(!open)}
      >
        Open run details
      </button>
      <Component
        {...args}
        anchor={anchor}
        open={open}
        onClose={() => {
          setOpen(false);
          args.onClose();
        }}
      />
    </div>
  );
}
