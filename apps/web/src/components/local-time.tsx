'use client';
// A time in the viewer's own locale and time zone. The server can't know either, so the text is filled in
// only after hydration; the server and the first client render both leave it empty and so always match.
import { useSyncExternalStore } from 'react';

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
  if (!d || Number.isNaN(d.getTime())) return null;
  return (
    <time dateTime={iso} title={hydrated ? d.toLocaleString() : undefined} className={className}>
      {hydrated ? d.toLocaleString([], FORMATS[format]) : ''}
    </time>
  );
}
