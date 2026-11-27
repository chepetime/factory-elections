'use client';
// A side pane with a drag handle on one edge. The width is saved in a cookie (read on the server,
// so the next page load starts at it). Arrow keys resize by 16px; a double click resets it.
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { paneCookie, type PaneSpec } from '@/lib/pane-spec';
import { cn } from '@factory/ui/lib/utils';

/** Below the breakpoint the pane takes its natural width and cannot be resized. */
const AT = {
  md: { width: 'md:w-[var(--pane-w)] md:shrink-0', handle: 'max-md:hidden' },
  lg: { width: 'lg:w-[var(--pane-w)] lg:shrink-0', handle: 'max-lg:hidden' },
} as const;

export function ResizablePane({
  spec,
  initialWidth,
  edge,
  breakpoint = 'lg',
  label,
  className,
  children,
}: {
  spec: PaneSpec;
  initialWidth: number;
  /** The edge the handle sits on: `left` for a pane on the right of the page. */
  edge: 'left' | 'right';
  breakpoint?: keyof typeof AT;
  /** The pane's accessible name; the handle is "Resize <label>". */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(initialWidth);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(spec.max, Math.max(spec.min, w)));
  const save = (w: number) => {
    document.cookie = `${paneCookie(spec.id)}=${w}; path=/; max-age=31536000; samesite=lax`;
  };
  const resize = (next: number) => {
    const w = clamp(next);
    setWidth(w);
    save(w);
  };
  const sign = edge === 'left' ? -1 : 1;

  return (
    <aside
      aria-label={label}
      style={{ '--pane-w': `${width}px` } as CSSProperties}
      className={cn('relative min-w-0', AT[breakpoint].width, className)}
    >
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label.toLowerCase()}`}
        aria-valuenow={width}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        tabIndex={0}
        className={cn(
          'absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-ring focus-visible:after:bg-ring',
          edge === 'left' ? '-left-1' : '-right-1',
          AT[breakpoint].handle,
        )}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, w: width };
        }}
        onPointerMove={(e) => {
          if (drag.current) setWidth(clamp(drag.current.w + sign * (e.clientX - drag.current.x)));
        }}
        onPointerUp={() => {
          if (drag.current) save(width);
          drag.current = null;
        }}
        onDoubleClick={() => resize(spec.default)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          resize(width + (e.key === 'ArrowRight' ? 16 : -16) * sign);
        }}
      />
    </aside>
  );
}
