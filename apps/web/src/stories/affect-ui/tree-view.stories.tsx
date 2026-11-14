import type { Meta, StoryObj } from '@storybook/react-vite';
import { TreeView } from '@factory/affect-ui/components/tree-view-clean';
import { TreeView as ClassicTreeView } from '@factory/affect-ui/components/tree-view';
import { expect, fn, userEvent, within } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Tree View',
  component: TreeView,
  tags: ['autodocs'],
  parameters: {
    // axe 4.14 treats descendant tree items and aria-describedby metadata as part
    // of the parent's visible label. APG trees label each node independently.
    // Check these exact names, descriptions, and keyboard behavior below instead.
    a11y: { config: { rules: [{ id: 'label-content-name-mismatch', enabled: false }] } },
    docs: {
      description: {
        component:
          'A nested list of folders and files or any hierarchy. Official MIT source. [Usage reference](https://www.affectui.com/components/tree-view) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/tree-view-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const source = canvas.getByRole('treeitem', { name: 'src' });
    const task = canvas.getByRole('treeitem', { name: 'tasks.ts' });
    await expect(source).toHaveAccessibleName('src');
    await expect(task).toHaveAccessibleDescription('128 lines');
    await userEvent.click(task);
    await userEvent.keyboard('{ArrowLeft}');
    await expect(source).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(source).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{ArrowRight}');
    await expect(source).toHaveAttribute('aria-expanded', 'true');
  },
  args: {
    'aria-label': 'Project files',
    items: [
      {
        id: 'src',
        label: 'src',
        children: [
          { id: 'tasks', label: 'tasks.ts', meta: '128 lines' },
          { id: 'review', label: 'review.ts' },
        ],
      },
      { id: 'tests', label: 'tests', children: [{ id: 'task-tests', label: 'tasks.test.ts' }] },
    ],
    defaultExpanded: ['src'],
    defaultSelected: 'tasks',
    onSelect: fn(),
  },
} satisfies Meta<typeof TreeView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicTreeView {...args} /> };
