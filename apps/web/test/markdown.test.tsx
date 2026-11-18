import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Markdown } from '@/components/markdown';

it('renders a pipe table with a header row and body cells', () => {
  const html = renderToStaticMarkup(
    <Markdown
      text={'Picked:\n\n| Package | Latest |\n|---|---|\n| `pg` | 8.23.1 |\n| nuqs | 2.10.3 |\n\nDone.'}
    />,
  );
  expect(html).toMatch(/<table[\s\S]*<th[^>]*>Package<\/th><th[^>]*>Latest<\/th>/);
  expect(html).toMatch(/<td[^>]*><code[^>]*>pg<\/code><\/td><td[^>]*>8\.23\.1<\/td>/);
  expect(html).toContain('<p>Done.</p>');
  expect(html).not.toContain('|---|');
});
