// The Harbor Lighthouse logo: the favicon (src/app/icon.svg) as an inline component.
import { useId } from 'react';
import { cn } from '@/lib/utils';

export function HarborMark({ className }: { className?: string }) {
  // Unique gradient ids, so two marks on one page do not share or clash.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const tile = `${id}-tile`;
  const light = `${id}-light`;
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-9', className)}>
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f1f1f" />
          <stop offset="1" stopColor="#050505" />
        </linearGradient>
        <linearGradient id={light} gradientUnits="userSpaceOnUse" x1="160" y1="48" x2="352" y2="408">
          <stop offset="0" stopColor="#ffa24a" />
          <stop offset="1" stopColor="#e0530f" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill={`url(#${tile})`} />
      <svg x="3" y="3" width="26" height="26" viewBox="76 48 360 360">
        <g fill={`url(#${light})`}>
          <circle cx="256" cy="62" r="14" />
          <path d="M211 121 C211 97 231 77 256 77 C281 77 301 97 301 121 C301 128 297 132 290 129 C280 124 269 121 256 121 C243 121 232 124 222 129 C215 132 211 128 211 121Z" />
          <rect x="230" y="132" width="52" height="32" rx="8" />
          <rect x="208" y="171" width="96" height="24" rx="12" />
          <path d="M222 203 L290 203 L319 358 C321 367 315 373 306 373 L206 373 C197 373 191 367 193 358Z" />
          <path d="M194 355 C209 344 228 339 246 339 L266 339 C284 339 303 344 318 355 C334 367 348 379 354 392 C358 401 353 408 343 408 L169 408 C159 408 154 401 158 392 C164 379 178 367 194 355Z" />
        </g>
      </svg>
    </svg>
  );
}
