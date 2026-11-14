import type { Meta, StoryObj } from '@storybook/react-vite';
import { Switch } from '@factory/affect-ui/components/switch-clean';
import { Switch as ClassicSwitch } from '@factory/affect-ui/components/switch';
import { expect, fn, userEvent, within } from 'storybook/test';

const meta = {
  title: 'affectUI/Components/Switch',
  component: Switch,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'On or off for things that apply right away. Official MIT source. [Usage reference](https://www.affectui.com/components/switch) \u00b7 [Pinned source](https://github.com/flohoeller/affectui/blob/46721aa59276d97927a8cb89ee898027b637834d/components/switch-clean.tsx). Sample actions only log to Storybook.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('switch', { name: /Automatic refresh/ });
    await expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await expect(toggle).not.toBeChecked();
  },
  args: {
    label: 'Automatic refresh',
    description: 'Keep the task list up to date.',
    defaultChecked: true,
    onChange: fn(),
  },
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicSwitch {...args} /> };
