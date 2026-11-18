import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend/client';
import { saveProjectSettings, sendReviewMessage, startReviews } from '@/app/actions';
import { Markdown } from '@/components/markdown';
import { ReviewReport } from '@/components/review-report';

vi.mock('@factory/backend/client', () => ({ backendCall: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
const rpc = vi.mocked(backendCall);
afterEach(() => vi.clearAllMocks());

describe('review actions', () => {
  it('validates input before starting reviews and reports per-PR failures', async () => {
    expect((await startReviews('app', [], 'review')).error).toMatch(/Select/);
    expect((await startReviews('app', [1.5], 'review')).error).toMatch(/Select/);
    expect((await startReviews('../x', [1], 'review')).error).toMatch(/Invalid project/);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({
      json: JSON.stringify([
        { number: 1, ok: true },
        { number: 2, ok: false, error: 'Remote branch origin/x not found' },
      ]),
    });
    expect(await startReviews('app', [1, 2], 'review')).toEqual({
      message: 'Started 1 review.',
      failed: [{ number: 2, error: 'Remote branch origin/x not found' }],
    });
    expect(rpc).toHaveBeenCalledWith(
      'StartReviews',
      { project: 'app', numbers: [1, 2], mode: 'review' },
      600_000,
    );
  });
  it('sends follow-ups and settings through the backend', async () => {
    expect((await sendReviewMessage('app', 3, '  ')).error).toMatch(/Write/);
    rpc.mockResolvedValue({ text: 'Sent' });
    expect(await sendReviewMessage('app', 3, ' Why? ')).toEqual({ message: 'Sent.' });
    expect(rpc).toHaveBeenCalledWith('SendReviewMessage', { project: 'app', number: 3, text: 'Why?' });
    rpc.mockResolvedValue({ json: JSON.stringify({ task_manager: { kind: 'jira' } }) });
    expect(await saveProjectSettings('app', { task_manager: { kind: 'jira' } })).toEqual({
      message: 'Saved.',
    });
    expect(rpc).toHaveBeenLastCalledWith('SaveProjectSettings', {
      project: 'app',
      json: JSON.stringify({ task_manager: { kind: 'jira' } }),
    });
  });
});

describe('review rendering', () => {
  it('renders agent markdown as elements, never as raw HTML', () => {
    const html = renderToStaticMarkup(
      <Markdown
        text={
          '**Verdict:** Comment\n1. Fix `x`\n<script>alert(1)</script>\n[PR](https://github.com/o/r/pull/1) [bad](javascript:alert(1))'
        }
      />,
    );
    expect(html).toContain('<strong>Verdict:</strong>');
    expect(html).toContain('<ol');
    expect(html).toContain('<code');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://github.com/o/r/pull/1"');
    expect(html).not.toContain('href="javascript');
  });
  it('renders the report from a partial payload', () => {
    const html = renderToStaticMarkup(
      <ReviewReport
        payload={{
          meta: { decision: 'Request changes', summary: 'One blocker.', risk_level: 'high' },
          findings: [
            {
              severity: 'must-fix',
              title: 'Missing auth check',
              file: 'a.ts',
              line_range: '4-9',
              comment: 'Add it.',
            },
          ],
        }}
      />,
    );
    expect(html).toContain('Request changes');
    expect(html).toContain('1 blocking · 0 suggestions');
    expect(html).toContain('Missing auth check');
    expect(html).toContain('a.ts:4-9');
  });
});
