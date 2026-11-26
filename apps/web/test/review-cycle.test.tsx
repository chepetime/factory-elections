import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReviewTicketCard, SelfReviewCard } from '@/components/review-cycle';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/actions', () => ({ decideReview: vi.fn(), moveIssue: vi.fn() }));
vi.mock('@/components/local-time', () => ({ LocalTime: ({ iso }: { iso?: string }) => <time>{iso}</time> }));

const base = {
  number: 12,
  url: 'https://github.com/o/r/pull/12',
  title: 'Add search',
  author: 'ana',
  rounds: [],
};
const round = { at: '2026-11-26T10:00:00.000Z', mode: 'review' as const, head_sha: 'abcdef1234' };

describe('review ticket card', () => {
  it('offers to start when no round ran', () => {
    const html = renderToStaticMarkup(<ReviewTicketCard project="demo" issueKey="DE-1" review={base} />);
    expect(html).toContain('Not started');
    expect(html).toContain('Start the review');
    expect(html).toContain('#12 by ana');
  });
  it('shows the proposal with the skill options for its decision, and the finding counts', () => {
    const html = renderToStaticMarkup(
      <ReviewTicketCard
        project="demo"
        issueKey="DE-1"
        review={{
          ...base,
          rounds: [
            {
              ...round,
              ended_at: '2026-11-26T10:05:00.000Z',
              decision: 'Comment',
              summary: 'Comment. Rename it.',
            },
          ],
        }}
        report={{ counts: { 'should-fix': 2 } }}
      />,
    );
    expect(html).toMatch(/Round 1[\s\S]*Review of abcdef1[\s\S]*Comment/);
    expect(html).toContain('Comment. Rename it.');
    expect(html).toContain('2 should-fix');
    expect(html).toMatch(/Approve with comments[\s\S]*Comment only[\s\S]*Post nothing/);
    expect(html).toContain('href="/projects/demo/reviews/12"');
  });
  it('says why a round has no report, and offers another round', () => {
    const html = renderToStaticMarkup(
      <ReviewTicketCard
        project="demo"
        issueKey="DE-1"
        review={{
          ...base,
          rounds: [
            {
              ...round,
              ended_at: '2026-11-26T10:05:00.000Z',
              reason: 'Refused permission to save its report.',
            },
          ],
        }}
      />,
    );
    expect(html).toContain('Refused permission to save its report.');
    expect(html).toContain('Review again');
    expect(html).not.toContain('What to post');
  });
  it('shows a posted choice instead of buttons', () => {
    const html = renderToStaticMarkup(
      <ReviewTicketCard
        project="demo"
        issueKey="DE-1"
        review={{
          ...base,
          rounds: [
            {
              ...round,
              ended_at: '2026-11-26T10:05:00.000Z',
              decision: 'Request changes',
              posted: { option: 'request-changes', label: 'Request changes', at: 'x', done_at: 'y' },
            },
          ],
        }}
      />,
    );
    expect(html).toContain('Posted: Request changes');
    expect(html).not.toContain('What to post');
  });
});

describe('self-review card', () => {
  it('lists each round with what went back to the agent, and a stop reason', () => {
    const html = renderToStaticMarkup(
      <SelfReviewCard
        project="demo"
        loop={{
          pr: 4,
          state: 'stopped',
          round: 2,
          fixes: 1,
          cycle: 1,
          recheck: false,
          notes: [],
          sent: [],
          history: [
            { at: 'a', round: 1, decision: 'Request changes', sent: 2, left: 1 },
            { at: 'b', round: 2, decision: 'Comment', sent: 0, left: 3 },
          ],
          reason: 'The senior PR review ended without a report.',
          updated_at: 'c',
        }}
      />,
    );
    expect(html).toMatch(/Round 1[\s\S]*Request changes[\s\S]*2 sent back to the agent · 1 noted for people/);
    expect(html).toMatch(/Round 2[\s\S]*nothing sent back/);
    expect(html).toContain('The senior PR review ended without a report.');
    expect(html).toContain('href="/projects/demo/reviews/4"');
  });
});
