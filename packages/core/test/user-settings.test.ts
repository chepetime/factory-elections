import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelRefused, UserSettings, withUserRules } from '../src/index.ts';

test('user settings default to every provider and model on, and no rules', () => {
  const settings = UserSettings.parse({});
  assert.equal(modelRefused(settings, 'claude-opus-5-5'), undefined);
  assert.equal(modelRefused(settings, 'codex'), undefined);
  assert.equal(withUserRules('Base', settings), 'Base');
});

test('a turned-off provider or model is refused, and rules follow the system prompt', () => {
  const settings = UserSettings.parse({
    providers: { codex: { enabled: false }, claude: { disabled_models: ['claude-opus-5-5'] } },
    rules: '  Never push to main.  ',
  });
  assert.match(modelRefused(settings, 'codex:gpt-6-astra')!, /Codex is turned off/);
  assert.match(modelRefused(settings, 'claude-opus-5-5')!, /claude-opus-5-5 is turned off/);
  assert.equal(modelRefused(settings, 'claude-sonnet-5-5'), undefined);
  assert.equal(
    withUserRules('Base', settings),
    'Base\n\n## Rules from the person who runs this factory\n\nNever push to main.',
  );
});

test('a GitHub username is checked', () => {
  assert.throws(() => UserSettings.parse({ identity: { github_username: '@octo cat' } }));
  assert.equal(
    UserSettings.parse({ identity: { github_username: 'octo-cat' } }).identity.github_username,
    'octo-cat',
  );
});
