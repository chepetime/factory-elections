'use client';
import { CodeBlock } from '@factory/ui/components/code-block';

/** Command or run output as a scrollable, copyable code block, so line breaks and spacing stay intact. */
export function OutputBlock({
  output,
  tone,
  label = tone === 'danger' ? 'Error output' : 'Output',
  maxHeight = '18rem',
}: {
  output: string;
  /** `danger` marks the output of a failed step: red edge and accent, and an "Error output" label. */
  tone?: 'danger';
  label?: string;
  maxHeight?: string;
}) {
  return (
    <CodeBlock
      code={output}
      filename={label}
      wrap
      maxHeight={maxHeight}
      tone={tone === 'danger' ? 'destructive' : 'default'}
      className="mt-2"
    />
  );
}
