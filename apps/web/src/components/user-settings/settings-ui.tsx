'use client';
// Building blocks for the /user views: a page title with save status, card groups of rows, a switch,
// and a hook that saves one settings section on each change. Nothing here has a Save button.
import { Check, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { updateUserSettings } from '@/app/actions';
import type { UserSettings } from '@/lib/user-settings';
import { cn } from '@factory/ui/lib/utils';
import { Switch as UiSwitch } from '@factory/ui/components/switch';

type Section = 'identity' | 'preferences' | 'tasks' | 'chat' | 'notifications' | 'providers' | 'rules';
export type SaveStatus =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; error: string };

/** One section's value, saved to the backend on `save`. `edit` changes it on screen only (text input). */
export function useSection<K extends Section>(section: K, initial: UserSettings[K]) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [, start] = useTransition();
  const stored = useRef(JSON.stringify(initial));
  const save = (next: UserSettings[K] = value) => {
    setValue(next);
    const json = JSON.stringify(next);
    if (json === stored.current) return;
    setStatus({ kind: 'saving' });
    start(async () => {
      const result = await updateUserSettings(section, next);
      if (result.error) return setStatus({ kind: 'error', error: result.error });
      stored.current = json;
      setStatus({ kind: 'saved' });
      // Theme, defaults and the sidebar name come from the root layout.
      router.refresh();
    });
  };
  return { value, edit: setValue, save, status };
}

export function SettingsPage({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description?: string;
  status?: SaveStatus;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p
          role="status"
          className={cn(
            'flex min-h-8 items-center gap-1.5 text-xs',
            status?.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {status?.kind === 'saving' && (
            <>
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />{' '}
              Saving
            </>
          )}
          {status?.kind === 'saved' && (
            <>
              <Check aria-hidden="true" className="size-3.5" /> Saved
            </>
          )}
          {status?.kind === 'error' && <>Not saved: {status.error}</>}
        </p>
      </div>
      {description && <p className="mt-2 max-w-prose text-sm text-muted-foreground">{description}</p>}
      <div className="mt-6 flex flex-col gap-8">{children}</div>
    </div>
  );
}

export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
      <div className="mt-3 divide-y overflow-hidden rounded-xl border bg-card">{children}</div>
    </section>
  );
}

/** One setting: label and hint on the left, the control on the right, or under them when `stacked`. */
export function SettingRow({
  label,
  hint,
  stacked,
  children,
}: {
  label: string;
  hint?: ReactNode;
  stacked?: boolean;
  children: (id: string, hintId: string | undefined) => ReactNode;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div
      className={cn(
        'gap-x-6 gap-y-2.5 px-4 py-3.5',
        stacked ? 'flex flex-col' : 'grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
      )}
    >
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="mt-0.5 text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <div className={cn('min-w-0', !stacked && 'sm:w-72 sm:justify-self-end')}>
        {children(id, hint ? hintId : undefined)}
      </div>
    </div>
  );
}

/** A switch for a row whose control is only on/off; it sits at the row's right edge. */
export function Switch({
  id,
  checked,
  onChange,
  describedBy,
  disabled,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  describedBy?: string | undefined;
  disabled?: boolean;
}) {
  return (
    <UiSwitch
      id={id}
      checked={checked}
      onCheckedChange={(next) => onChange(next)}
      aria-describedby={describedBy}
      disabled={disabled}
      className="ml-auto pointer-coarse:my-2.5"
    />
  );
}

/** A row that is only a switch. The label names the switch. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SettingRow label={label} hint={hint}>
      {(id, hintId) => (
        <Switch id={id} checked={checked} onChange={onChange} describedBy={hintId} disabled={disabled} />
      )}
    </SettingRow>
  );
}

export const selectClass =
  'h-9 w-full cursor-pointer rounded-lg border bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-11';
