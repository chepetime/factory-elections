'use client';
import { useId } from 'react';
import { CodeBlock, type CodeBlockProps } from '@factory/affect-ui/components/code-block-clean';

type Run = { kind: 'add' | 'del'; from: number; to: number };

/** Consecutive added or deleted lines, counted from 1 like the code block's lines. */
export function diffRuns(diff: string): Run[] {
  const lines = diff.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const runs: Run[] = [];
  lines.forEach((line, i) => {
    const kind =
      line.startsWith('+') && !line.startsWith('+++')
        ? 'add'
        : line.startsWith('-') && !line.startsWith('---')
          ? 'del'
          : undefined;
    if (!kind) return;
    const last = runs.at(-1);
    if (last && last.kind === kind && last.to === i) last.to = i + 1;
    else runs.push({ kind, from: i + 1, to: i + 1 });
  });
  return runs;
}

/**
 * The upstream code block with added and deleted lines colored. The upstream source stays
 * byte-for-byte, so the colors come from scoped `nth-child` ranges over its line elements.
 */
export function DiffCodeBlock({
  code,
  ...props
}: Omit<CodeBlockProps, 'code' | 'language'> & { code: string }) {
  const scope = `diff-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const css = diffRuns(code)
    .map(
      ({ kind, from, to }) =>
        `.${scope} .ui-codec__line:nth-child(n+${from}):nth-child(-n+${to}){background:var(--diff-${kind}-bg)}` +
        `.${scope} .ui-codec__line:nth-child(n+${from}):nth-child(-n+${to}) .ui-codec__text{color:var(--diff-${kind})}`,
    )
    .join('');
  return (
    <div
      className={`${scope} [--diff-add-bg:rgb(22_163_74/0.08)] [--diff-add:#15803d] [--diff-del-bg:rgb(220_38_38/0.08)] [--diff-del:#b91c1c] dark:[--diff-add:#4ade80] dark:[--diff-del:#f87171]`}
      data-diff-runs={css ? 'true' : undefined}
    >
      {css && <style>{css}</style>}
      <CodeBlock code={code} language="diff" {...props} />
    </div>
  );
}
