import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROJECT_ACCENTS, ProjectSettings, projectAccent } from '../src/index.ts';

test('a project without an accent gets the same color from its name every time', () => {
  const color = projectAccent('change-elections');
  assert.ok((PROJECT_ACCENTS as readonly string[]).includes(color));
  assert.equal(projectAccent('change-elections'), color);
  const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((n) => projectAccent(n)));
  assert.ok(colors.size > 3, 'names spread over the palette');
});

test('a picked accent wins, and an invalid one falls back to the name color', () => {
  assert.equal(projectAccent('demo', '#12ABef'), '#12abef');
  assert.equal(projectAccent('demo', 'red'), projectAccent('demo'));
  assert.equal(projectAccent('demo', ''), projectAccent('demo'));
});

test('project settings accept a #rrggbb accent or an empty one, and nothing else', () => {
  assert.equal(ProjectSettings.parse({ accent: '#22c55e' }).accent, '#22c55e');
  assert.equal(ProjectSettings.parse({ accent: '' }).accent, '');
  assert.throws(() => ProjectSettings.parse({ accent: 'green' }));
});

test('every name gets a palette color', () => {
  for (let i = 0; i < 2000; i++)
    assert.ok((PROJECT_ACCENTS as readonly string[]).includes(projectAccent(`project-${i}`)), `project-${i}`);
});
