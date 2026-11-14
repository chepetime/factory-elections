import { describe, expect, it } from 'vitest';
import { isAllowed } from '@/proxy';

describe('local-only proxy', () => {
  it('allows reads addressed to this machine', () => {
    expect(isAllowed('GET', '127.0.0.1:4317', null)).toBe(true);
    expect(isAllowed('GET', 'localhost:4317', null)).toBe(true);
  });
  it('rejects other hosts (DNS rebinding)', () => {
    expect(isAllowed('GET', 'evil.example:4317', null)).toBe(false);
    expect(isAllowed('GET', null, null)).toBe(false);
  });
  it('requires a same-origin Origin for writes', () => {
    expect(isAllowed('POST', '127.0.0.1:4317', 'http://127.0.0.1:4317')).toBe(true);
    expect(isAllowed('POST', '127.0.0.1:4317', null)).toBe(false);
    expect(isAllowed('POST', '127.0.0.1:4317', 'https://evil.example')).toBe(false);
    expect(isAllowed('POST', '127.0.0.1:4317', 'http://localhost:4317')).toBe(false);
  });
});
