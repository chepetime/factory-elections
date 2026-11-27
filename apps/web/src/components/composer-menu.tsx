'use client';

import type { ReactNode } from 'react';
import { DropdownMenuContent } from '@factory/ui/components/dropdown-menu';

export const composerMenuRow =
  'flex min-h-11 cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50';

export function ComposerMenu({
  label,
  align,
  children,
  showHeading = true,
  side = 'top',
}: {
  label: string;
  showHeading?: boolean;
  align: 'start' | 'end';
  side?: 'top' | 'right';
  children: ReactNode;
}) {
  return (
    <DropdownMenuContent
      align={align}
      side={side}
      sideOffset={8}
      aria-label={label}
      className="max-h-[min(24rem,var(--available-height))] w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-1.5 motion-safe:ease-out data-ending-style:transition-none"
    >
      {showHeading && <div className="px-3 py-2 text-sm text-muted-foreground">{label}</div>}
      {children}
    </DropdownMenuContent>
  );
}
