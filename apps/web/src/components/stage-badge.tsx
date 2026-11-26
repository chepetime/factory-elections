import { Badge } from '@/components/ui/badge';
import { stageLabel, type Stage } from '@factory/core';

const TONE: Record<Stage, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'outline',
  classified: 'outline',
  blocked: 'destructive',
  coding: 'secondary',
  'verification-failed': 'destructive',
  reviewing: 'secondary',
  'awaiting-approval': 'default',
  approved: 'default',
  rejected: 'outline',
  'pr-opened': 'secondary',
  failed: 'destructive',
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge variant={TONE[stage]}>{stageLabel(stage)}</Badge>;
}
