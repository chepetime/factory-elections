import { Bot } from 'lucide-react';
import type { ReactNode } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { LocalTime } from '@/components/local-time';

/** Who speaks in a run: the workspace agent for an agent run, else Factory's pipeline. */
export type RunAuthor = { name: string; avatar: string };

export function AgentMessage({
  at,
  author,
  children,
}: {
  at?: string;
  author?: RunAuthor;
  children: ReactNode;
}) {
  return (
    <div className="group/msg flex gap-3">
      {author ? (
        <AgentAvatar agent={author} decorative className="mt-0.5 size-7 text-sm" />
      ) : (
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
          <Bot className="size-4" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs text-muted-foreground">
          {author?.name ?? 'Factory'}
          {at && (
            <span
              className={
                'opacity-0 transition-opacity [@media(hover:none)]:opacity-100 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100'
              }
            >
              {' '}
              · <LocalTime iso={at} format="date-time" />
            </span>
          )}
        </p>
        {children}
      </div>
    </div>
  );
}
