import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentCheckpoints, checkpointGraph, type Checkpoint } from '@/components/agent-checkpoints';
import { checkpointDemoReducer } from '@/components/agent-checkpoints-demo';

const checkpoints: Checkpoint[] = [
  { id: 'a', title: 'Read task', cost: 0.1 },
  { id: 'b', parent: 'a', title: 'First implementation', status: 'failed', cost: 0.2 },
  { id: 'c', parent: 'a', title: 'Second implementation', status: 'running', cost: 0.3 },
];

describe('agent checkpoints', () => {
  it('keeps previous attempts in separate stable lanes and highlights only head ancestry', () => {
    const graph = checkpointGraph(checkpoints, 'c');
    expect([...graph.active]).toEqual(['c', 'a']);
    expect([...graph.nodes.values()].map((node) => node.lane)).toEqual([0, 0, 1]);
    const restored = checkpointGraph([...checkpoints, { id: 'd', parent: 'b', title: 'Retry' }], 'd');
    expect([...restored.active]).toEqual(['d', 'b', 'a']);
    expect(restored.nodes.get('c')?.lane).toBe(1);
    expect(restored.nodes.get('d')?.lane).toBe(0);
  });

  it('rewinds without losing history and stops the previous running checkpoint', () => {
    const state = { checkpoints, head: 'c', message: '' };
    const next = checkpointDemoReducer(state, { type: 'rewind', checkpoint: checkpoints[0]! });
    expect(next.checkpoints).toHaveLength(4);
    expect(next.checkpoints[1]!.status).toBe('failed');
    expect(next.checkpoints[2]!.status).toBe('stopped');
    expect(next.checkpoints[3]).toMatchObject({ parent: 'a', status: 'running', id: next.head });
    expect(state.checkpoints[2]!.status).toBe('running');
    const completed = checkpointDemoReducer(next, { type: 'complete' });
    expect(completed.checkpoints.at(-1)?.status).toBe('done');
    expect(checkpointDemoReducer(completed, { type: 'reset' }).head).toBe('retry');
  });

  it('renders a single tab stop, the current step, statuses and cost across all attempts', () => {
    const html = renderToStaticMarkup(
      <AgentCheckpoints checkpoints={checkpoints} head="c" onRewind={() => {}} />,
    );
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('Previous attempt');
    expect(html).toContain('failed');
    expect(html).toContain('$0.60');
  });

  it('handles an empty run', () => {
    const html = renderToStaticMarkup(<AgentCheckpoints checkpoints={[]} />);
    expect(html).toContain('Checkpoints will appear as the agent works.');
  });
});
