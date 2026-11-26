import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { withMentionLinks } from '@/components/task-feed';
import { MentionTextarea } from '@/components/mention-textarea';

describe('mentions in comments', () => {
  const authors = { devin: { name: 'Devin', avatar: '🐸' } };
  it('links each recorded mention to the agent by name, and leaves other @words alone', () => {
    expect(withMentionLinks('Increase the budget @devin, not @nobody', ['devin'], authors)).toBe(
      'Increase the budget [@Devin](/agents/devin), not @nobody',
    );
    expect(withMentionLinks('@devin', [], authors)).toBe('@devin');
  });
  it('renders the comment box as a combobox with no list until @ is typed', () => {
    const html = renderToStaticMarkup(
      <MentionTextarea
        id="c"
        value="Hi"
        onValueChange={() => {}}
        agents={[{ id: 'devin', name: 'Devin', avatar: '🐸' }]}
      />,
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
  });
});
