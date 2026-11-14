import type { Meta, StoryObj } from '@storybook/react-vite';
import { Dialog } from '@factory/affect-ui/components/dialog-clean';
import { Dialog as ClassicDialog } from '@factory/affect-ui/components/dialog';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A modal window on a dimmed backdrop. Official MIT source. [Usage reference](https://www.affectui.com/components/dialog) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/dialog-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Open settings' });
    await userEvent.click(trigger);
    await expect(canvas.getByRole('dialog', { name: 'Project settings' })).toBeVisible();
    // userEvent does not invoke the browser's native dialog cancel default action.
    await userEvent.click(canvas.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(canvas.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
  args: {
    title: 'Project settings',
    description: 'A local preview of a settings dialog.',
    trigger: (
      <button type="button" className="min-h-11 rounded-lg border px-4">
        Open settings
      </button>
    ),
    children: <p>Changes made here affect only this story.</p>,
    onOpenChange: fn(),
  },
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicDialog {...args} /> };
