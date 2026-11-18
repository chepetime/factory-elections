import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { TOOL_CATALOG, ToolDefinition, ToolProvider } from '../src/tools.ts';

test('catalog covers providers with unique tools and operations', () => {
  assert.deepEqual(new Set(TOOL_CATALOG.map((tool) => tool.provider)), new Set(ToolProvider.options));
  assert.equal(new Set(TOOL_CATALOG.map((tool) => tool.name)).size, TOOL_CATALOG.length);
  for (const tool of TOOL_CATALOG) {
    ToolDefinition.parse(tool);
    assert.equal(new Set(tool.operations.map((operation) => operation.name)).size, tool.operations.length);
  }
  assert.equal(
    TOOL_CATALOG.find((tool) => tool.name === 'github')?.operations.find((op) => op.name === 'submit_review')
      ?.level,
    'publish',
  );
});
