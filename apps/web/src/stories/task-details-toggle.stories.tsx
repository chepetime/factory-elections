import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { TaskDetailsToggleButton } from '@/components/task-details-toggle-button';

const meta = {
  title: 'Factory/Task details toggle',
  component: TaskDetailsToggleButton,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          "The ticket header's button for the right sidebar (Run, Status, Timeline, Changes, Details). The page saves the choice in the user settings and does not render the sidebar while it is hidden.",
      },
    },
  },
  args: { expanded: true, onToggle: () => {} },
  render: (args) => (
    <div className="flex w-72 items-center gap-2 border-b px-3 py-2 text-sm">
      <span className="font-mono text-xs text-muted-foreground">DE-1</span>
      <span className="truncate font-medium">Fix the checkout</span>
      <TaskDetailsToggleButton {...args} />
    </div>
  ),
} satisfies Meta<typeof TaskDetailsToggleButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shown: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Hide task details' });
    await expect(button).toHaveAttribute('aria-expanded', 'true');
  },
};

export const Hidden: Story = {
  args: { expanded: false },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Show task details' });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  },
};

export const Toggling: Story = {
  render: (args) => {
    const [expanded, setExpanded] = useState(true);
    return <TaskDetailsToggleButton {...args} expanded={expanded} onToggle={() => setExpanded((e) => !e)} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Hide task details' }));
    await expect(canvas.getByRole('button', { name: 'Show task details' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  },
};
