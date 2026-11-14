import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentFindings, type Finding, type FindingAgent } from '@/components/agent-findings';

const agents: FindingAgent[] = [
  { id: 'security', name: 'Security', done: 3, total: 5 },
  { id: 'tests', name: 'Tests', done: 4, total: 4 },
];
const findings: Finding[] = [
  { id: 'older', agentId: 'security', title: 'Older warning', severity: 'warning', at: 10_000 },
  {
    id: 'newest',
    agentId: 'tests',
    title: 'Newest critical finding',
    severity: 'critical',
    at: 60_000,
    location: 'task.ts:10',
  },
  { id: 'middle', agentId: 'security', title: 'Middle note', severity: 'note', at: 20_000 },
];

describe('agent findings', () => {
  it('orders findings by time and limits the feed without changing total severity counts', () => {
    const html = renderToStaticMarkup(
      <AgentFindings agents={agents} findings={findings} now={65_000} rows={2} />,
    );
    expect(html.indexOf('Newest critical finding')).toBeLessThan(html.indexOf('Middle note'));
    expect(html).not.toContain('Older warning');
    expect(html).toContain('Showing the latest 2 of 3 findings.');
    expect(html).toContain('1 critical, 1 warnings across the review.');
    expect(findings.map((finding) => finding.id)).toEqual(['older', 'newest', 'middle']);
  });

  it('exposes agent filters, progress, explicit severity labels, and live updates', () => {
    const html = renderToStaticMarkup(
      <AgentFindings agents={agents} findings={findings} now={65_000} onOpen={() => {}} />,
    );
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).toContain('3 of 5 checks.');
    expect(html).toContain('4 of 4 checks.');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Critical');
    expect(html).toContain('task.ts:10');
    expect(html).toContain('5s');
  });

  it('handles empty runs and clamps invalid progress values', () => {
    const empty = renderToStaticMarkup(<AgentFindings agents={[]} findings={[]} />);
    expect(empty).toContain('No agents assigned yet.');
    expect(empty).toContain('No findings yet.');
    const clamped = renderToStaticMarkup(
      <AgentFindings
        agents={[
          { id: 'a', name: 'Overrun', done: 9, total: 3 },
          { id: 'b', name: 'Unstarted', done: -2, total: 0 },
        ]}
        findings={[]}
      />,
    );
    expect(clamped).toContain('3 of 3 checks.');
    expect(clamped).toContain('0 of 0 checks.');
  });
});
