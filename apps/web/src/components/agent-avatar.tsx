import { cn } from '@factory/ui/lib/utils';

const SIZE = { sm: 'size-5 text-xs', md: 'size-8 text-base', lg: 'size-16 text-3xl' } as const;

/** An agent's emoji in a round tile. The name is the accessible label unless `decorative`. */
export function AgentAvatar({
  agent,
  size = 'md',
  decorative = false,
  className,
}: {
  agent: { name: string; avatar: string };
  size?: keyof typeof SIZE;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : agent.name}
      aria-hidden={decorative || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border bg-muted/60 leading-none select-none',
        SIZE[size],
        className,
      )}
    >
      {agent.avatar}
    </span>
  );
}
