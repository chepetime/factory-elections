import { describe, expect, it } from 'vitest';
import { parseDoctor, summarize } from '@/lib/status-checks';

describe('parseDoctor', () => {
  it('reads ok and FAIL lines and attaches fix hints', () => {
    const out = [
      'ok    Node.js >= 26: v26.13.1',
      'FAIL  GitHub CLI signed in: not signed in',
      '      fix: Run `gh auth login`.',
      'ok    Data root: /tmp/f (available)',
      '',
    ].join('\n');
    expect(parseDoctor(out)).toEqual([
      { id: 'env-node-js-26', group: 'Environment', name: 'Node.js >= 26', status: 'ok', detail: 'v26.13.1' },
      {
        id: 'env-github-cli-signed-in',
        group: 'Environment',
        name: 'GitHub CLI signed in',
        status: 'fail',
        detail: 'not signed in',
        fix: 'Run `gh auth login`.',
      },
      {
        id: 'env-data-root',
        group: 'Environment',
        name: 'Data root',
        status: 'ok',
        detail: '/tmp/f (available)',
      },
    ]);
  });
});

describe('summarize', () => {
  const c = (status: 'ok' | 'warn' | 'fail') => ({
    id: status,
    group: 'Engine' as const,
    name: '',
    status,
    detail: '',
  });
  it('reports the worst status', () => {
    expect(summarize([c('ok'), c('warn')])).toEqual({ status: 'warn', failing: 0, warning: 1 });
    expect(summarize([c('warn'), c('fail')]).status).toBe('fail');
    expect(summarize([]).status).toBe('ok');
  });
});
