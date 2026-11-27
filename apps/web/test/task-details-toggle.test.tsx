import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskDetailsToggleButton } from '@/components/task-details-toggle-button';

const noop = () => {};

it('offers to hide the sidebar while it is open', () => {
  const html = renderToStaticMarkup(<TaskDetailsToggleButton expanded onToggle={noop} />);
  expect(html).toContain('aria-label="Hide task details"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('title="Hide task details (⌘\\)"');
  expect(html).toContain('aria-keyshortcuts="Control+\\ Meta+\\"');
});

it('offers to show the sidebar while it is hidden', () => {
  const html = renderToStaticMarkup(<TaskDetailsToggleButton expanded={false} onToggle={noop} />);
  expect(html).toContain('aria-label="Show task details"');
  expect(html).toContain('aria-expanded="false"');
});

it('is disabled while the choice is being saved', () => {
  expect(renderToStaticMarkup(<TaskDetailsToggleButton expanded pending onToggle={noop} />)).toContain(
    'disabled=""',
  );
});
