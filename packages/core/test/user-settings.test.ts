import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelRefused, NOTIFY_KINDS, UserSettings, withUserRules, type InboxKind } from '../src/index.ts';

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

test('what the person wrote about themselves comes before their rules', () => {
  const settings = UserSettings.parse({ identity: { about: 'Backend engineer.' }, rules: 'Small PRs.' });
  assert.equal(
    withUserRules('Base', settings),
    'Base\n\n## About the person you work for\n\nBackend engineer.\n\n## Rules from the person who runs this factory\n\nSmall PRs.',
  );
});

test('notification settings name every inbox kind', () => {
  // Fails to compile when the inbox gains a kind the settings cannot mute.
  const covered: Exclude<InboxKind, (typeof NOTIFY_KINDS)[number]> extends never ? true : false = true;
  assert.equal(covered, true);
  assert.deepEqual(UserSettings.parse({}).notifications, { browser: false, muted: [] });
});

test('the ticket sidebar is shown by default, including for settings saved without the key', () => {
  assert.equal(UserSettings.parse({}).tasks.details_pane, true);
  const old = UserSettings.parse({
    tasks: { default_type: 'review', start_runs: true, jira_key_field: false },
  });
  assert.equal(old.tasks.details_pane, true);
  assert.equal(old.tasks.default_type, 'review');
  assert.equal(UserSettings.parse({ tasks: { details_pane: false } }).tasks.details_pane, false);
});
