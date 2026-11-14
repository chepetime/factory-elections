import type { Meta, StoryObj } from '@storybook/react-vite';
import { ComponentSupport } from '@/components/component-support';

const meta = {
  title: 'Library/Support Roadmap',
  component: ComponentSupport,
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof ComponentSupport>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Overview: Story = {};
