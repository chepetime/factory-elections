import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { CodeBlock } from '@factory/ui/components/code-block';

const meta = {
  title: 'shadcn/Code Block',
  component: CodeBlock,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'From @factory/ui. Copies the original input text, with optional line numbers, marked lines, wrapping, an internal scroll limit, diff coloring and a destructive tone for failed output.',
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
export const TypeScript: Story = {};
export const Json: Story = {
  args: {
    code: '{\n  "status": "running",\n  "checks": 12\n}',
    language: 'json',
    filename: 'run.json',
    highlightLines: [],
  },
};
export const Diff: Story = {
  args: {
    code: 'diff --git a/src/run.ts b/src/run.ts\n@@ -1,3 +1,3 @@\n export function run() {\n-  return start();\n+  return start({ retry: true });\n }',
    language: 'diff',
    filename: 'Changes.diff',
    highlightLines: [],
  },
};
export const FailedOutput: Story = {
  args: {
    code: 'Error: tests failed\n  at run (src/run.ts:2:10)',
    language: undefined,
    filename: 'Error output',
    showLineNumbers: false,
    highlightLines: [],
    tone: 'destructive',
    wrap: true,
  },
};
export const LongLines: Story = {
  args: {
    code: 'const instructions = "Review the implementation, identify actionable findings, preserve all saved attempts, and explain the next step to the user.";',
    wrap: true,
  },
};
