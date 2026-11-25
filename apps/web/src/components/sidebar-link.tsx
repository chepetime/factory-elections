import Link from 'next/link';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function SidebarLink({
  current,
  className,
  ...props
}: Omit<ComponentProps<typeof Link>, 'aria-current'> & { current: boolean }) {
  return (
    <Link
      {...props}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex min-w-0 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-foreground outline-offset-[-2px] pointer-coarse:min-h-11 motion-safe:transition-colors hover:bg-foreground/5 active:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-background aria-[current=page]:font-medium aria-[current=page]:shadow-xs aria-[current=page]:ring-1 aria-[current=page]:ring-foreground/15 aria-[current=page]:ring-inset aria-[current=page]:hover:bg-background',
        className,
      )}
    />
  );
}
