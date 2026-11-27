import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PersonAttention } from '@factory/core';
import { cn } from '@factory/ui/lib/utils';

/** A card on the ticket for something only you can do now, in the tone of its attention state. */
const ATTENTION_TONE: Record<PersonAttention, { box: string; heading: string }> = {
  review: { box: 'border-blue-500/40 bg-blue-500/5', heading: 'text-blue-800 dark:text-blue-300' },
  reply: { box: 'border-amber-500/40 bg-amber-500/5', heading: 'text-amber-800 dark:text-amber-300' },
  problem: { box: 'border-destructive/40 bg-destructive/5', heading: 'text-destructive' },
};

export function AttentionCard({
  title,
  kind,
  children,
}: {
  title: string;
  kind: PersonAttention;
  children: ReactNode;
}) {
  const tone = ATTENTION_TONE[kind];
  return (
    <section aria-label={title} className={cn('rounded-xl border p-4 text-sm', tone.box)}>
      <h2 className={cn('mb-2 flex items-center gap-2 font-semibold', tone.heading)}>
        <CircleAlert className="size-4" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}
