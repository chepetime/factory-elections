'use client';
// Live run output in a fixed-height panel that follows new lines, unless you scrolled up to read.
import { ArrowDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { stripAnsi } from '@/lib/task-chat';
import { cn } from '@/lib/utils';

export function LiveOutput({ output, className }: { output: string; className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const [following, setFollowing] = useState(true);
  const text = stripAnsi(output);

  // Before paint, so a new line never flashes above the bottom edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [text, following]);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div className={cn('relative mt-2', className)}>
      <pre
        ref={ref}
        role="log"
        aria-label="Live output"
        aria-live="off"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
        className="h-64 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-5 whitespace-pre-wrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {text}
      </pre>
      {!following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-xs shadow-sm hover:bg-muted"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          Latest output
        </button>
      )}
    </div>
  );
}
