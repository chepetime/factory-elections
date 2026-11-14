import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import origins from '../../../resources/frontend-component-origins.json';
import support from '../../../resources/frontend-component-support.json';

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('frontend component support roadmap', () => {
  it('preserves the complete original list, its order, and its public references', () => {
    expect(support.items.map((item) => [item.name, item.reference])).toEqual(Object.entries(origins));
    expect(new Set(support.items.map((item) => item.name)).size).toBe(26);
    expect(support.items.find((item) => item.name === 'App Shell Flat')?.kind).toBe('screen');
  });
  it('links implemented components to real files and distinguishes imported free source', () => {
    for (const item of support.items.filter((entry) => entry.status === 'implemented')) {
      expect(existsSync(resolve(root, item.implementation!)), item.name).toBe(true);
      expect(item.storybookId).toBeTruthy();
      expect(item.integration).toBe('demo');
    }
    expect(support.items.find((item) => item.name === 'Chat Composer')).toMatchObject({
      status: 'implemented',
      storybookId: 'factory-chat-composer--interactive',
    });
    expect(support.items.find((item) => item.name === 'Thinking Loader')).toMatchObject({
      status: 'available',
      integration: 'upstream-mit',
    });
    expect(support.items.filter((item) => item.status === 'planned')).toHaveLength(22);
  });
});
