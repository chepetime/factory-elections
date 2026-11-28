import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '@/components/markdown';
import { highlightMentions, MentionTextarea } from '@/components/mention-textarea';

const agents = [{ id: 'devin', name: 'Devin', avatar: '🐸' }];

describe('mentions in comments', () => {
  it('renders a known mention as a chip with avatar and name, linking to the agent', () => {
    const html = renderToStaticMarkup(
      <Markdown
        text="@devin Resolve the conflicts, ping @nobody, not `@devin`"
        mentions={{ devin: { ...agents[0]!, href: '/projects/demo/agents/devin' } }}
      />,
    );
    // Agent pages live under a project; a bare /agents/<id> has no route.
    expect(html).toMatch(
      /<a [^>]*href="\/projects\/demo\/agents\/devin"[^>]*><span aria-hidden="true"[^>]*>🐸<\/span>Devin<\/a> Resolve/,
    );
    const unlinked = renderToStaticMarkup(<Markdown text="@devin hi" mentions={{ devin: agents[0]! }} />);
    expect(unlinked).not.toContain('<a ');
    expect(unlinked).toContain('Devin');
    expect(html).toContain('ping @nobody');
    expect(html).toContain('<code');
    expect(html).not.toContain('[@Devin]');
  });
  it('leaves @words as text when no agent is known', () => {
    expect(renderToStaticMarkup(<Markdown text="Hi @devin" />)).toContain('Hi @devin');
  });
});

describe('mention highlight while typing', () => {
  it('marks known mentions only, keeping every character in place', () => {
    const html = renderToStaticMarkup(
      <>{highlightMentions('Fix it @devin and @nobody, me@devin', new Set(['devin']))}</>,
    );
    expect(html.match(/data-mention="devin"/g)).toHaveLength(1);
    expect(html.replace(/<[^>]+>/g, '')).toBe('Fix it @devin and @nobody, me@devin');
  });
  it('renders the box as a combobox over a highlight layer, with no list until @ is typed', () => {
    const html = renderToStaticMarkup(
      <MentionTextarea id="c" value="Hi @devin" onValueChange={() => {}} agents={agents} />,
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-hidden="true"[^>]*>Hi <mark data-mention="devin"/);
    expect(html).not.toContain('role="listbox"');
  });
});
