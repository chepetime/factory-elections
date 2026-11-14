import type { Meta, StoryObj } from '@storybook/react-vite';
import { ContextMenu } from '@factory/affect-ui/components/context-menu-clean';
import { ContextMenu as ClassicContextMenu } from '@factory/affect-ui/components/context-menu';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Context Menu',
  component: ContextMenu,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The menu a right-click opens, right at the pointer. Official MIT source. [Usage reference](https://www.affectui.com/components/context-menu) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/context-menu-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Right-click or press Shift+F10' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await waitFor(() => expect(canvas.getByRole('menu', { name: 'Sample file actions' })).toBeVisible());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('menu')).not.toBeInTheDocument());
  },
  args: {
    title: 'Sample file actions',
    items: [
      { label: 'Open file', onSelect: fn() },
      { label: 'Copy path', onSelect: fn() },
      { label: 'Rename', onSelect: fn() },
    ],
    children: (
      <button type="button" className="min-h-11 rounded-lg border px-4">
        Right-click or press Shift+F10
      </button>
    ),
  },
} satisfies Meta<typeof ContextMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicContextMenu {...args} /> };
