import type { Meta, StoryObj } from '@storybook/react-vite';
import { DropdownMenu } from '@factory/affect-ui/components/dropdown-menu-clean';
import { DropdownMenu as ClassicDropdownMenu } from '@factory/affect-ui/components/dropdown-menu';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Dropdown Menu',
  component: DropdownMenu,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Actions and choices behind any trigger. Official MIT source. [Usage reference](https://www.affectui.com/components/dropdown-menu) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/dropdown-menu-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Project actions' });
    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.getByRole('menu', { name: 'Project actions' })).toBeVisible());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
  args: {
    title: 'Project actions',
    trigger: ({ triggerProps }) => (
      <button {...triggerProps} type="button" className="min-h-11 rounded-lg border px-4">
        Project actions
      </button>
    ),
    items: [
      { label: 'Open project', onSelect: fn() },
      { label: 'Copy project path', onSelect: fn() },
      { label: 'Archive project', disabled: true },
    ],
  },
} satisfies Meta<typeof DropdownMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicDropdownMenu {...args} /> };
