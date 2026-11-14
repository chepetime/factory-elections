import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import inventory from '../../../resources/affect-ui-free-components.json';
import { CodeBlock } from '@factory/affect-ui/components/code-block-clean';
import { DecisionInbox } from '@factory/affect-ui/components/decision-inbox-clean';
import { SegmentedControl } from '@factory/affect-ui/components/segmented-control-clean';

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('free affectUI library integration', () => {
  it('retains the upstream MIT license and verifies every installed source against the pinned manifest', () => {
    const license = readFileSync(resolve(root, 'packages/affect-ui/LICENSE'), 'utf8');
    expect(license).toContain('MIT License');
    expect(license).toContain('Copyright (c) 2026 Florian Höller (adfects)');
    expect(inventory.items).toHaveLength(74);
    expect(inventory.items.filter((item) => item.category === 'components')).toHaveLength(51);
    expect(new Set(inventory.items.map((item) => `${item.category}/${item.slug}`)).size).toBe(74);
    for (const item of inventory.items) {
      for (const variant of item.variants) {
        const content = readFileSync(resolve(root, variant.path));
        expect(createHash('sha256').update(content).digest('hex'), variant.path).toBe(variant.sha256);
        expect(variant.sourceUrl).toContain(`/blob/${inventory.revision}/`);
        expect(variant.exports.length).toBeGreaterThan(0);
      }
    }
    expect(inventory.items.some((item) => item.slug === 'agent-checkpoints')).toBe(false);
  });

  it('gives every free item individual stories for all installed style variants', () => {
    const directory = resolve(root, 'apps/web/src/stories');
    const stories = readdirSync(directory, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.stories.tsx'))
      .map((path) => readFileSync(resolve(directory, path), 'utf8'));
    for (const item of inventory.items) {
      expect(item.storybookId).toBe(
        item.storybookTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
      );
      const story = stories.find((source) => source.includes(`title: '${item.storybookTitle}'`));
      expect(story, item.slug).toBeDefined();
      for (const variant of item.variants) {
        const name =
          variant.style === 'default' ? 'Default' : variant.style === 'clean' ? 'Clean' : 'Classic';
        expect(story, `${item.slug}/${name}`).toContain(`export const ${name}: Story`);
        expect(story, variant.importPath).toContain(variant.importPath);
      }
    }
  });

  it('renders the three featured upstream modules through the package boundary', () => {
    const code = renderToStaticMarkup(
      <CodeBlock code={'const count = 3;'} language="ts" filename="example.ts" showLineNumbers />,
    );
    expect(code).toContain('example.ts');
    expect(code).toContain('Copy');
    const decisions = renderToStaticMarkup(
      <DecisionInbox decisions={[{ id: 'one', title: 'Run checks?', primary: 'Run', secondary: 'Later' }]} />,
    );
    expect(decisions).toContain('Run checks?');
    expect(decisions).toContain('1');
    const control = renderToStaticMarkup(
      <SegmentedControl
        aria-label="View"
        defaultValue="board"
        options={[
          { value: 'list', label: 'List' },
          { value: 'board', label: 'Board' },
        ]}
      />,
    );
    expect(control).toContain('role="radiogroup"');
    expect(control.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(control.match(/tabindex="0"/g)).toHaveLength(1);
  });
});
