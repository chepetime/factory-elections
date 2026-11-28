import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EmergencyStopState } from '@factory/core';
import { EmergencyStopBanner, EmergencyStopButton, EmergencyStopProvider } from '@/components/emergency-stop';

vi.mock('@/app/emergency-actions', () => ({
  emergencyStop: vi.fn(async () => ({})),
  resumeFactory: vi.fn(async () => ({})),
}));

const render = (initial?: EmergencyStopState) =>
  renderToStaticMarkup(
    <EmergencyStopProvider initial={initial}>
      <EmergencyStopButton />
      <EmergencyStopBanner />
    </EmergencyStopProvider>,
  );

it('offers a hold-to-stop control and no banner while the factory runs', () => {
  const html = render({ on: false });
  expect(html).toContain('aria-label="Emergency stop: hold to stop every agent"');
  expect(html).not.toContain('role="alert"');
});

it('shows the stop on every page with what it stopped, and offers Resume', () => {
  const html = render({
    on: true,
    since: '2026-11-27T20:15:00.000Z',
    stopped: { runs: 2, reviews: 1, executions: 0 },
  });
  expect(html).toContain('role="alert"');
  expect(html).toContain('Emergency stop is on');
  expect(html).toContain('It stopped 2 task runs, 1 review and 0 other agents.');
  expect(html).toContain('Resume factory');
  expect(html).toContain('aria-label="Emergency stop is on"');
  expect(html).not.toContain('hold to stop every agent');
});

it('says nothing was running when the press stopped nothing', () => {
  const html = render({ on: true, stopped: { runs: 0, reviews: 0, executions: 0 } });
  expect(html).toContain('Nothing was running.');
});
