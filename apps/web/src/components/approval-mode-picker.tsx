'use client';

import { Menu } from '@base-ui/react/menu';
import { Check, CircleCheck, Hand, ShieldAlert } from 'lucide-react';
import { Button } from '@factory/ui/components/button';
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
    <Menu.Root modal={false}>
      <Menu.Trigger
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
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={8} className="z-50 outline-none">
          <Menu.Popup
            aria-label="How should actions be approved?"
            className="max-h-[var(--available-height)] w-[570px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none motion-safe:transition-opacity motion-safe:duration-100 motion-safe:ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:transition-none"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 px-3 py-2 text-sm text-muted-foreground">
              <span>How should actions be approved?</span>
              {helpUrl && (
                <Menu.Item
                  render={<a href={helpUrl} />}
                  className="inline-flex min-h-11 items-center rounded-sm underline-offset-4 outline-none hover:underline data-highlighted:underline"
                >
                  Learn more
                </Menu.Item>
              )}
            </div>
            <Menu.RadioGroup value={value} onValueChange={(next) => onChange(next as ApprovalMode)}>
              {MODES.map((mode) => {
                const ModeIcon = mode.icon;
                return (
                  <Menu.RadioItem
                    key={mode.id}
                    value={mode.id}
                    closeOnClick
                    className="flex min-h-11 cursor-default items-start gap-3 rounded-lg px-3 py-2.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
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
                    <Menu.RadioItemIndicator className="mt-0.5 shrink-0">
                      <Check aria-hidden="true" className="size-5" />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                );
              })}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
