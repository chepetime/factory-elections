import { Badge } from '@factory/ui/components/badge';
import { runAttention, stageLabel, type RunAttention, type Stage } from '@factory/core';

// The pill follows the attention rule, so a stage reads the same as its sidebar group:
// red only for a problem, amber for a needed reply, blue for a review.
const TONE: Record<RunAttention, { variant: 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  problem: { variant: 'destructive' },
  reply: { variant: 'secondary', className: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  review: { variant: 'secondary', className: 'bg-blue-500/10 text-blue-800 dark:text-blue-300' },
  working: { variant: 'secondary' },
  waiting: { variant: 'outline' },
  done: { variant: 'secondary' },
  closed: { variant: 'outline' },
};

export function StageBadge({ stage }: { stage: Stage }) {
  const { variant, className } = TONE[runAttention(stage)];
  return (
    <Badge variant={variant} className={className}>
      {stageLabel(stage)}
    </Badge>
  );
}
