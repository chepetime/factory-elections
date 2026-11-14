import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import {
  SegmentedControl,
  type SegmentedControlProps,
} from '@factory/affect-ui/components/segmented-control-clean';
import { SegmentedControl as ClassicSegmentedControl } from '@factory/affect-ui/components/segmented-control';

const meta = {
  title: 'affectUI/Components/Segmented Control',
  component: SegmentedControl,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Official MIT source. Radio mode is an immediate choice; tabs mode should control named tab panels. Arrow keys and Home/End change selection. Use Controls to set the starting value; clicks and keys update the preview locally and log onChange.',
      },
    },
  },
  args: {
    'aria-label': 'Task view',
    value: 'list',
    variant: 'tray',
    options: [
      { value: 'list', label: 'List', count: 12 },
      { value: 'board', label: 'Board' },
      { value: 'timeline', label: 'Timeline' },
    ],
    onChange: fn(),
  },
  render: (args) => <SegmentedPreview key={args.value} {...args} />,
} satisfies Meta<SegmentedControlProps>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Clean: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const board = canvas.getByRole('radio', { name: 'Board' });
    await userEvent.click(board);
    await waitFor(() => expect(board).toHaveAttribute('aria-checked', 'true'));
    await userEvent.keyboard('{End}');
    await waitFor(() =>
      expect(canvas.getByRole('radio', { name: 'Timeline' })).toHaveAttribute('aria-checked', 'true'),
    );
    await userEvent.keyboard('{Home}');
    await waitFor(() =>
      expect(canvas.getByRole('radio', { name: 'List 12' })).toHaveAttribute('aria-checked', 'true'),
    );
  },
};
export const Classic: Story = { render: (args) => <SegmentedPreview key={args.value} {...args} classic /> };
export const Underline: Story = { args: { variant: 'underline' } };
export const DisabledOption: Story = {
  args: { options: meta.args.options.map((option) => ({ ...option, disabled: option.value === 'board' })) },
};

function SegmentedPreview({ classic = false, ...args }: SegmentedControlProps & { classic?: boolean }) {
  const [value, setValue] = useState(args.value);
  const onChange = (next: string) => {
    setValue(next);
    args.onChange?.(next);
  };
  return classic ? (
    <ClassicSegmentedControl
      {...args}
      value={value}
      variant={args.variant === 'buttons' ? 'tray' : args.variant}
      onChange={onChange}
    />
  ) : (
    <SegmentedControl {...args} value={value} onChange={onChange} />
  );
}
