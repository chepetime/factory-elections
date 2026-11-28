import Image from 'next/image';
import { PROVIDER_NAMES, type ProviderId } from '@factory/core';
import { cn } from '@factory/ui/lib/utils';

// Claude and Pi use their site favicons. The Codex app icon is from the orchestrator provider assets.
export function ProviderIcon({
  provider,
  model,
  className,
}: {
  provider: ProviderId;
  model?: string;
  className?: string;
}) {
  const label = model ? `${PROVIDER_NAMES[provider]} · ${model}` : undefined;
  return (
    <span className={cn('inline-flex size-4 shrink-0 items-center justify-center', className)} title={label}>
      {provider === 'pi' ? (
        <span
          aria-hidden
          className="size-[85%] bg-current"
          style={{ mask: "url('/providers/pi.svg') center / contain no-repeat" }}
        />
      ) : (
        <Image
          src={`/providers/${provider}.png`}
          width={16}
          height={16}
          alt=""
          className="size-full"
          unoptimized
        />
      )}
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
