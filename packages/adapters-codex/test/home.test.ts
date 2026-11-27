import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isolatedCodexHome } from '../src/home.ts';

test('isolated CODEX_HOME holds the factory config and only the login from the user home', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-home-test-'));
  const user = join(root, 'user');
  mkdirSync(user);
  writeFileSync(join(user, 'config.toml'), '[mcp_servers.personal]\ncommand = "x"\n');
  writeFileSync(join(user, 'auth.json'), '{"token":"t"}');
  const dir = isolatedCodexHome({ FACTORY_CODEX_HOME: join(root, 'factory'), CODEX_HOME: user });
  assert.equal(dir, join(root, 'factory'));
  assert.doesNotMatch(readFileSync(join(dir, 'config.toml'), 'utf8'), /personal/);
  assert.equal(readFileSync(join(dir, 'auth.json'), 'utf8'), '{"token":"t"}');
  assert.deepEqual(readdirSync(dir).sort(), ['auth.json', 'config.toml']);
});
