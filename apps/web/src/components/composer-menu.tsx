'use client';

import type { ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';

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
    <Menu.Portal>
      <Menu.Positioner align={align} side={side} sideOffset={8} className="z-50 outline-none">
        <Menu.Popup
          aria-label={label}
          className="max-h-[min(24rem,var(--available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none motion-safe:transition-opacity motion-safe:duration-100 motion-safe:ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:transition-none"
        >
          {showHeading && <div className="px-3 py-2 text-sm text-muted-foreground">{label}</div>}
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}
