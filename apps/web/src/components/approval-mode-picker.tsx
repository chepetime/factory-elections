'use client';

import { CircleCheck, Hand, ShieldAlert } from 'lucide-react';
import { Button } from '@factory/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@factory/ui/components/dropdown-menu';
import { cn } from '@factory/ui/lib/utils';

export type ApprovalMode = 'request' | 'auto' | 'full';

const MODES = [
  {
    id: 'request',
    label: 'Request approval',
    description: 'Always ask before editing outside files or using the internet',
    icon: Hand,
  },
  {
    id: 'auto',
    label: 'Approve for me',
    description: 'Only ask for potentially unsafe actions',
    icon: CircleCheck,
  },
  {
    id: 'full',
    label: 'Full access',
    description: 'Unrestricted access to the internet and all files on your computer',
    icon: ShieldAlert,
  },
] as const;

export function ApprovalModePicker({
  value,
  onChange,
  disabled,
  helpUrl,
}: {
  value: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
  disabled?: boolean;
  helpUrl?: string;
}) {
  const selected = MODES.find((mode) => mode.id === value) ?? MODES[0];
  const Icon = selected.icon;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-11 gap-2 px-2 text-muted-foreground"
          />
        }
        aria-label={selected.label}
        disabled={disabled}
      >
        <Icon aria-hidden="true" className={cn('size-4', value === 'full' && 'text-destructive')} />
        <span className={cn('hidden text-xs @min-[480px]:inline', value === 'full' && 'text-destructive')}>
          {selected.label}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        aria-label="How should actions be approved?"
        className="w-[570px] max-w-[calc(100vw-2rem)] rounded-2xl p-1.5 motion-safe:ease-out data-ending-style:transition-none"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 px-3 py-2 text-sm text-muted-foreground">
          <span>How should actions be approved?</span>
          {helpUrl && (
            <DropdownMenuItem
              render={<a href={helpUrl} />}
              className="inline-flex min-h-11 rounded-sm px-0 py-0 text-muted-foreground underline-offset-4 hover:underline focus:bg-transparent focus:text-muted-foreground focus:underline"
            >
              Learn more
            </DropdownMenuItem>
          )}
        </div>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as ApprovalMode)}>
          {MODES.map((mode) => {
            const ModeIcon = mode.icon;
            return (
              <DropdownMenuRadioItem
                key={mode.id}
                value={mode.id}
                closeOnClick
                className="min-h-11 items-start gap-3 rounded-lg py-2.5 pr-10 pl-3 [&_[data-slot=dropdown-menu-radio-item-indicator]]:top-3 [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:size-5"
              >
                <ModeIcon
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 size-5 shrink-0 text-muted-foreground',
                    mode.id === 'full' && 'text-destructive',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-base', mode.id === 'full' && 'text-destructive')}>
                    {mode.label}
                  </span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
                    {mode.description}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
