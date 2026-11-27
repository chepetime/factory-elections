import { CodeBlock, type CodeBlockProps } from '@factory/ui/components/code-block';

/** A unified diff with line numbers, added and deleted lines colored. */
export function DiffView(props: Omit<CodeBlockProps, 'language' | 'showLineNumbers'>) {
  return <CodeBlock language="diff" showLineNumbers {...props} />;
}
