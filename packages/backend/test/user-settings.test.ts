import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storageFor } from '@factory/adapters-data';
import { codexConfiguredModel, parsePiModels, UserSettingsService } from '../src/user-settings.ts';

test('user settings default, then save without empty fields', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-user-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const user = new UserSettingsService(root, storageFor(root));
  assert.equal((await user.get()).providers.pi.enabled, true);
  await user.save({
    json: JSON.stringify({
      identity: { name: 'Ada', github_username: '' },
      providers: { pi: { enabled: false } },
    }),
  });
  const saved = await user.get();
  assert.equal(saved.identity.name, 'Ada');
  assert.equal(saved.identity.github_username, undefined);
  assert.equal(saved.providers.pi.enabled, false);
  assert.equal(saved.providers.claude.enabled, true);
});

test('the environment reads git, gh and each CLI, and marks a missing CLI', async () => {
  const answers: Record<string, { code: number; stdout: string; stderr: string }> = {
    'git config --global user.name': { code: 0, stdout: 'Ada\n', stderr: '' },
    'git config --global user.email': { code: 0, stdout: 'ada@example.com\n', stderr: '' },
    'gh api user --jq .login': { code: 0, stdout: 'ada\n', stderr: '' },
    'claude --version': { code: 0, stdout: '2.1.331 (Claude Code)\n', stderr: '' },
    'codex --version': { code: 127, stdout: '', stderr: 'spawn codex ENOENT' },
    'pi --version': { code: 0, stdout: '1.6.0\n', stderr: '' },
    'pi --list-models': {
      code: 0,
      stdout: 'provider  model  context\nanthropic  claude-opus-5-5  1M\nopenai-codex  gpt-6-sol  400K\n',
      stderr: '',
    },
  };
  const root = await mkdtemp(join(tmpdir(), 'factory-user-'));
  const user = new UserSettingsService(root, storageFor(root), {
    exec: async (command, args) => answers[[command, ...args].join(' ')]!,
    readCodexConfig: async () => undefined,
  });
  const env = await user.environment();
  await rm(root, { recursive: true, force: true });
  assert.deepEqual(env.git, { name: 'Ada', email: 'ada@example.com' });
  assert.equal(env.github.login, 'ada');
  assert.equal(env.providers.claude.version, '2.1.331');
  assert.equal(env.providers.codex.installed, false);
  assert.deepEqual(
    env.providers.pi.models.map((m) => m.id),
    ['anthropic/claude-opus-5-5', 'openai-codex/gpt-6-sol'],
  );
});

test('the Codex model comes from the top level of config.toml only', () => {
  assert.equal(codexConfiguredModel('model = "gpt-6-astra"\n[profiles.x]\nmodel = "other"'), 'gpt-6-astra');
  assert.equal(codexConfiguredModel('[profiles.x]\nmodel = "other"'), undefined);
  assert.deepEqual(parsePiModels('provider model\n'), []);
});
