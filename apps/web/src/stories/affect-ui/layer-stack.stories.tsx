import type { Meta, StoryObj } from '@storybook/react-vite';
import { LayerStack } from '@factory/affect-ui/illustrations/layer-stack';
import { expect, fn, userEvent, within } from 'storybook/test';

const meta = {
  title: 'affectUI/Illustrations/Layer Stack',
  component: LayerStack,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Isometric stack of five layers with a list beside it. Official MIT source. [Usage reference](https://www.affectui.com/illustrations/layer-stack) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/illustrations/layer-stack.tsx). Sample actions only log to Storybook.',
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
