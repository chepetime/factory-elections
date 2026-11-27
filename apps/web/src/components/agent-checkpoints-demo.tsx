'use client';

import { useReducer } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { AgentCheckpoints, type Checkpoint } from '@/components/agent-checkpoints';
import { Button } from '@factory/ui/components/button';

const INITIAL: Checkpoint[] = [
  { id: 'brief', title: 'Read the task and repository guidelines', at: 8_000, cost: 0.02 },
  { id: 'plan', parent: 'brief', title: 'Mapped the implementation', at: 24_000, cost: 0.04 },
  { id: 'build', parent: 'plan', title: 'Built the first implementation', at: 67_000, files: 3, cost: 0.12 },
  {
    id: 'tests',
    parent: 'build',
    title: 'Validation failed: two checks need attention',
    status: 'failed',
    at: 94_000,
    cost: 0.05,
  },
  {
    id: 'retry',
    parent: 'plan',
    title: 'Trying a smaller implementation',
    status: 'running',
    at: 112_000,
    files: 2,
    cost: 0.08,
  },
];

type DemoState = { checkpoints: Checkpoint[]; head: string; message: string };
type DemoAction = { type: 'rewind'; checkpoint: Checkpoint } | { type: 'complete' } | { type: 'reset' };
const initialState: DemoState = {
  checkpoints: INITIAL,
  head: 'retry',
  message: 'Rewind to a saved checkpoint to create another attempt.',
};

export function checkpointDemoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === 'reset') return initialState;
  if (action.type === 'complete') {
    return {
      ...state,
      checkpoints: state.checkpoints.map((checkpoint) =>
        checkpoint.id === state.head ? { ...checkpoint, status: 'done' } : checkpoint,
      ),
      message: 'Current checkpoint completed. Rewind to explore another approach.',
    };
  }
  if (action.checkpoint.id === state.head) return state;
  const id = `attempt-${state.checkpoints.length + 1}`;
  return {
    head: id,
    checkpoints: [
      ...state.checkpoints.map((checkpoint) =>
        checkpoint.status === 'running' ? { ...checkpoint, status: 'stopped' as const } : checkpoint,
      ),
      {
        id,
        parent: action.checkpoint.id,
        title: `New attempt from “${action.checkpoint.title}”`,
        status: 'running',
        at: (state.checkpoints.at(-1)?.at ?? 0) + 15_000,
        cost: 0.01,
      },
    ],
    message: `Restored “${action.checkpoint.title}”. A new attempt is running; earlier work is preserved.`,
  };
}

export function AgentCheckpointsDemo() {
  const [state, dispatch] = useReducer(checkpointDemoReducer, initialState);
  const running = state.checkpoints.find((checkpoint) => checkpoint.id === state.head)?.status === 'running';
  return (
    <div className="space-y-5">
      <AgentCheckpoints
        checkpoints={state.checkpoints}
        head={state.head}
        task="Implement a feature"
        onRewind={(checkpoint) => dispatch({ type: 'rewind', checkpoint })}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {state.message}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => dispatch({ type: 'reset' })}>
            <RotateCcw />
            Reset
          </Button>
          <Button className="min-h-11" disabled={!running} onClick={() => dispatch({ type: 'complete' })}>
            <Check />
            Complete checkpoint
          </Button>
        </div>
      </div>
    </div>
  );
}
