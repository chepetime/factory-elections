import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { CodeBlock } from '@factory/affect-ui/components/code-block-clean';
import { CodeBlock as ClassicCodeBlock } from '@factory/affect-ui/components/code-block';

const meta = {
  title: 'affectUI/Components/Code Block',
  component: CodeBlock,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Official MIT source from @factory/affect-ui. Clean and Classic have the same props. Copies the original input text, with optional line numbers, highlighting, wrapping, and an internal scroll limit.',
      },
    },
  },
  args: {
    code: 'export const agent = {\n  name: "Reviewer",\n  checks: ["types", "tests", "security"],\n};',
    language: 'ts',
    filename: 'agent.config.ts',
    showLineNumbers: true,
    highlightLines: [2],
    copyable: true,
    maxHeight: 320,
    onCopy: fn(),
  },
} satisfies Meta<typeof CodeBlock>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Clean: Story = {};
export const Classic: Story = { render: (args) => <ClassicCodeBlock {...args} /> };
export const Json: Story = {
  args: {
    code: '{\n  "status": "running",\n  "checks": 12\n}',
    language: 'json',
    filename: 'run.json',
    highlightLines: [],
  },
};
export const LongLines: Story = {
  args: {
    code: 'const instructions = "Review the implementation, identify actionable findings, preserve all saved attempts, and explain the next step to the user.";',
    wrap: true,
  },
};
