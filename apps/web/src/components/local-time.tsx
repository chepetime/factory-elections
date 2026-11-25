'use client';
// A time in the viewer's own locale and time zone. The server can't know either, so the text is filled in
// only after hydration; the server and the first client render both leave it empty and so always match.
import { useSyncExternalStore } from 'react';
import { useUserPreferences } from '@/components/user-preferences';

const never = () => () => {};

const FORMATS = {
  time: { hour: '2-digit', minute: '2-digit' },
  'date-time': { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export function LocalTime({
  iso,
  format = 'time',
  className,
}: {
  iso: string | undefined;
  format?: keyof typeof FORMATS;
  className?: string;
}) {
  const hydrated = useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
  const d = iso ? new Date(iso) : undefined;
  // A time zone chosen in user settings wins over the browser's own.
  const timeZone = useUserPreferences().preferences.time_zone;
  if (!d || Number.isNaN(d.getTime())) return null;
  const zone = timeZone ? { timeZone } : {};
  return (
    <time dateTime={iso} title={hydrated ? d.toLocaleString([], zone) : undefined} className={className}>
      {hydrated ? d.toLocaleString([], { ...FORMATS[format], ...zone }) : ''}
    </time>
  );
}
