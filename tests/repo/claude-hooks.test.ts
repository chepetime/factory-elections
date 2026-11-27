import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, root } from './helpers.ts';

// A hook that names a missing script fails at the start of every agent session or edit.
type Hook = { command?: string };
type Settings = { hooks?: Record<string, { hooks?: Hook[] }[]> };

const settings: Settings = JSON.parse(read('.claude/settings.json'));
const commands = Object.entries(settings.hooks ?? {}).flatMap(([event, groups]) =>
  groups.flatMap((group) =>
    (group.hooks ?? []).flatMap((hook) => (hook.command ? [{ event, command: hook.command }] : [])),
  ),
);

test('.claude/settings.json declares hook commands', () => {
  assert.ok(
    commands.length > 0,
    'No hook commands found in .claude/settings.json; update tests/repo/claude-hooks.test.ts if hooks moved.',
  );
});

for (const { event, command } of commands) {
  test(`${event} hook script exists: ${command}`, () => {
    const scripts = [
      ...command.matchAll(/(?:\$CLAUDE_PROJECT_DIR"?\/|\s|^)((?:\.\/)?[\w./-]+\.(?:mjs|js|ts|sh))/g),
    ].map((match) => match[1]!);
    assert.ok(
      scripts.length > 0,
      `Rule: each hook command in .claude/settings.json names a script. Could not find one in: ${command}`,
    );
    const missing = scripts.filter((script) => !existsSync(resolve(root, script)));
    assert.deepEqual(
      missing,
      [],
      `Rule: each hook command in .claude/settings.json names a script that exists. ` +
        `Fix: restore the script or update the ${event} hook in .claude/settings.json. Missing: ${missing.join(', ')}`,
    );
  });
}
