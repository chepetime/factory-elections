import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReviewTicketCard, SelfReviewStopped } from '@/components/review-cycle';
import { ReviewOutcomeCard } from '@/components/review-outcome';
import { TaskPrLink } from '@/components/task-pr-link';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/actions', () => ({ decideReview: vi.fn(), moveIssue: vi.fn(), restartSelfReview: vi.fn() }));
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

describe('self-review in the activity', () => {
  it('shows a review round as an outcome card: decision, summary, counts, next step and report link', () => {
    const html = renderToStaticMarkup(
      <ReviewOutcomeCard
        project="demo"
        at="2026-11-26T23:16:46.794Z"
        outcome={{
          source: 'self',
          pr: 5,
          round: 1,
          decision: 'Comment',
          summary: 'The API mapping reads correctly.',
          counts: { 'should-fix': 2, 'must-fix': 1 },
          next: 'Nothing critical or must-fix. The PR is ready for review.',
        }}
      />,
    );
    expect(html).toMatch(/Self-review · round 1 of #5[\s\S]*Comment/);
    expect(html).toContain('The API mapping reads correctly.');
    expect(html.indexOf('1 must-fix')).toBeLessThan(html.indexOf('2 should-fix'));
    expect(html).toContain('The PR is ready for review.');
    expect(html).toContain('href="/projects/demo/reviews/5"');
  });
  it('says why a self-review stopped and offers to run it again, after the newest activity', () => {
    const html = renderToStaticMarkup(
      <SelfReviewStopped
        project="demo"
        runId="11111111-2222-4333-8444-555555555555"
        loop={{
          pr: 4,
          state: 'stopped',
          round: 1,
          fixes: 0,
          cycle: 1,
          recheck: false,
          resumed: 0,
          notes: [],
          sent: [],
          history: [],
          reason: 'The senior PR review ended without a report.',
          updated_at: 'c',
        }}
      />,
    );
    expect(html).toContain('Self-review of #4 stopped');
    expect(html).toContain('The senior PR review ended without a report.');
    expect(html).toContain('Review again');
  });
  it('keeps the PR link under the description, with its state', () => {
    const merged = renderToStaticMarkup(<TaskPrLink url="https://github.com/o/r/pull/5" state="MERGED" />);
    expect(merged).toContain('href="https://github.com/o/r/pull/5"');
    expect(merged).toContain('o/r#5');
    expect(merged).toContain('Merged');
  });
});
