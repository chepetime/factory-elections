import { afterEach, expect, it, vi } from 'vitest';
import { changeGate, stamp } from '@/lib/change-gate';

const answer = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);
afterEach(() => vi.unstubAllGlobals());

it('stamps one project or the sum of all, with the boot id', () => {
  const v = { boot: 'b1', projects: { a: 2, b: 3 } };
  expect([stamp(v, 'a'), stamp(v, 'c'), stamp(v)]).toEqual(['b1:2', 'b1:0', 'b1:5']);
});

it('loads only when the counter moved, the backend restarted, or a minute passed', async () => {
  const gate = changeGate(60_000);
  const at = (boot: string, a: number) => vi.stubGlobal('fetch', answer({ boot, projects: { a } }));
  at('b1', 1);
  expect(await gate.due('a')).toBe(false); // the first answer is the baseline: the caller loaded
  expect(await gate.due('a')).toBe(false);
  at('b1', 2);
  expect(await gate.due('a')).toBe(true);
  expect(await gate.due('a')).toBe(false);
  at('b2', 2);
  expect(await gate.due('a')).toBe(true); // same count, new backend
  vi.useFakeTimers({ now: Date.now() + 61_000 });
  expect(await gate.due('a')).toBe(true);
  vi.useRealTimers();
});

it('loads on every poll when versions cannot be read', async () => {
  const gate = changeGate();
  vi.stubGlobal('fetch', answer({}, false));
  expect([await gate.due('a'), await gate.due('a')]).toEqual([true, true]);
});
