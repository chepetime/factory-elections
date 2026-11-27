import type { Meta, StoryObj } from '@storybook/react-vite';
import { LayerStack } from '@/components/layer-stack';
import { expect, fn, userEvent, within } from 'storybook/test';

const meta = {
  title: 'Factory/Layer Stack',
  component: LayerStack,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Isometric stack of five layers with a list beside it, waiting for a place in the app (see TODO.md). Sample actions only log to Storybook.',
      },
    },
  },
  args: {
    items: [
      { title: 'Repository context', hint: 'Files', icon: 'database' },
      { title: 'Verification tools', hint: 'Checks', icon: 'plug' },
      { title: 'Review results', hint: 'Findings', icon: 'spark' },
    ],
    onChange: fn(),
  },
  render: (args) => (
    <div className="mx-auto w-full max-w-2xl">
      <LayerStack {...args} />
    </div>
  ),
} satisfies Meta<typeof LayerStack>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole('tab', { name: /Repository context/ });
    const second = canvas.getByRole('tab', { name: /Verification tools/ });
    const third = canvas.getByRole('tab', { name: /Review results/ });
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(first).toHaveAttribute('tabindex', '0');
    await userEvent.click(second);
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(args.onChange).toHaveBeenLastCalledWith(1);
    await userEvent.keyboard('{ArrowDown}');
    await expect(third).toHaveFocus();
    await expect(third).toHaveAttribute('aria-selected', 'true');
    await expect(args.onChange).toHaveBeenLastCalledWith(2);
    await userEvent.keyboard('{ArrowDown}');
    await expect(first).toHaveFocus();
    await expect(args.onChange).toHaveBeenLastCalledWith(0);
    await userEvent.keyboard('{ArrowUp}');
    await expect(third).toHaveFocus();
    await expect(args.onChange).toHaveBeenLastCalledWith(2);
  },
};

export const EmptyUsesDefaults: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('tab')).toHaveLength(5);
    await expect(canvas.getByRole('tab', { name: /Triggered by events/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};

export const AtMostFive: Story = {
  args: { items: Array.from({ length: 6 }, (_, i) => ({ title: `Layer ${i + 1}` })), defaultIndex: 99 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('tab')).toHaveLength(5);
    await expect(canvas.getByRole('tab', { name: 'Layer 5' })).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.queryByRole('tab', { name: 'Layer 6' })).toBeNull();
  },
};
