'use client';
// The task panel's stage timeline: the section title row holds the stage count and the toggle,
// so the timeline itself needs no second header.
import { ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { AgentCheckpoints, compactCheckpoints, type Checkpoint } from '@/components/agent-checkpoints';

export function StageTimeline({ checkpoints }: { checkpoints: Checkpoint[] }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = compactCheckpoints(checkpoints).hidden;
  return (
    <section aria-labelledby="panel-stages" className="border-b py-4 last:border-b-0">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-5">
        <h2
          id="panel-stages"
          className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
        >
          Stages
        </h2>
        <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          <span>
            {checkpoints.length} {checkpoints.length === 1 ? 'stage' : 'stages'}
          </span>
          {hidden > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
              className="inline-flex min-h-6 items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ChevronsUpDown aria-hidden className="size-3.5" />
              {expanded ? 'Compact' : 'Show all'}
            </button>
          )}
        </span>
      </div>
      <AgentCheckpoints
        title="Stage timeline"
        mode="timeline"
        header={false}
        expanded={expanded}
        onExpandedChange={setExpanded}
        className="rounded-none bg-transparent shadow-none ring-0"
        checkpoints={checkpoints}
      />
    </section>
  );
}
