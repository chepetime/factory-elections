// The Software Factory logo: the favicon (src/app/icon.svg) as an inline component.
import { useId } from 'react';
import { cn } from '@/lib/utils';

export function FactoryMark({ className }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const tile = `${id}-tile`;
  const fire = `${id}-fire`;
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-9', className)}>
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f1f1f" />
          <stop offset="1" stopColor="#050505" />
        </linearGradient>
        <linearGradient id={fire} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffa24a" />
          <stop offset="1" stopColor="#e0530f" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill={`url(#${tile})`} />
      <circle cx="23.4" cy="7.4" r="1.5" fill="#ff9a3d" opacity="0.7" />
      <circle cx="26.3" cy="4.2" r="2.1" fill="#ffc08a" />
      <path
        d="M3.5 27.5 V17 L9.5 12.5 V17 L15.5 12.5 V17 L20.5 13 V10 H25.5 V27.5 Z"
        fill={`url(#${fire})`}
      />
      <rect x="6.5" y="20" width="3.6" height="3.4" rx="0.9" fill="#050505" opacity="0.85" />
      <rect x="12.5" y="20" width="3.6" height="3.4" rx="0.9" fill="#050505" opacity="0.85" />
      <rect x="18.5" y="20" width="3.6" height="3.4" rx="0.9" fill="#fff4e6" />
    </svg>
  );
}
