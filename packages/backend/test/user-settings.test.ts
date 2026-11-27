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
  assert.deepEqual(saved.identity.emails, []);
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
    'claude auth status': { code: 0, stdout: '{"loggedIn":true}\n', stderr: '' },
    'codex login status': { code: 127, stdout: '', stderr: 'spawn codex ENOENT' },
    'git -C /work config --local user.email': { code: 0, stdout: 'ada@work.example\n', stderr: '' },
    'git -C /home config --local user.email': { code: 1, stdout: '', stderr: '' },
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
    projects: async () => [
      { name: 'work', repo: '/work' },
      { name: 'home', repo: '/home' },
    ],
  });
  const env = await user.environment();
  await rm(root, { recursive: true, force: true });
  assert.deepEqual(env.git, {
    name: 'Ada',
    email: 'ada@example.com',
    project_emails: [{ project: 'work', email: 'ada@work.example' }],
  });
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

test('a single email saved before the list becomes the first of the emails', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-user-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const user = new UserSettingsService(root, storageFor(root));
  await user.save({ json: JSON.stringify({ identity: { email: 'ada@example.com' } }) });
  assert.deepEqual((await user.get()).identity.emails, ['ada@example.com']);
  await assert.rejects(user.save({ json: JSON.stringify({ identity: { emails: ['not-an-email'] } }) }));
});

type Answer = { code: number; stdout: string; stderr: string; stopped?: 'timeout' };
const ok = (stdout = ''): Answer => ({ code: 0, stdout, stderr: '' });
const missing: Answer = { code: 127, stdout: '', stderr: 'spawn ENOENT' };
const PI_TABLE =
  'provider  model  context\nanthropic  claude-haiku-5-5  200K\nopenai-codex  gpt-6-sol  400K\n';

/** A service whose CLIs answer from `answers`; every command it ran lands in `calls`. */
function harness(
  answers: Record<string, Answer>,
  options: { env?: NodeJS.ProcessEnv; codexModel?: string } = {},
) {
  const calls: string[] = [];
  const dir = join(tmpdir(), 'factory-user-checks');
  const user = new UserSettingsService(dir, storageFor(dir), {
    exec: async (command, args) => {
      const key = [command, ...args].join(' ');
      calls.push(key);
      return answers[key] ?? ok();
    },
    env: options.env ?? {},
    readCodexConfig: async () => (options.codexModel ? `model = "${options.codexModel}"\n` : undefined),
  });
  return { user, calls };
}
const check = (
  env: Awaited<ReturnType<UserSettingsService['environment']>>,
  p: 'claude' | 'codex' | 'pi',
  n: string,
) => env.providers[p].checks.find((c) => c.name === n)!;

test('signed in passes when each CLI reports a login, without calling a model', async () => {
  const { user, calls } = harness({
    'claude --version': ok('2.1.331 (Claude Code)'),
    'claude auth status': ok('{"loggedIn":true}'),
    'codex --version': ok('codex-cli 0.9.0'),
    'codex login status': { code: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' },
    'pi --version': ok('1.6.0'),
    'pi --list-models': ok(PI_TABLE),
  });
  const env = await user.environment();
  for (const p of ['claude', 'codex', 'pi'] as const) {
    assert.equal(check(env, p, 'installed').ok, true);
    assert.equal(check(env, p, 'signed_in').ok, true);
    assert.match(check(env, p, 'signed_in').checked_at, /^\d{4}-\d\d-\d\dT/);
  }
  assert.equal(check(env, 'codex', 'signed_in').detail, 'Logged in using ChatGPT');
  assert.equal(check(env, 'pi', 'signed_in').detail, '2 models available');
  // Nothing that prompts a model ran: no -p, no `codex exec`.
  assert.deepEqual(
    calls.filter((c) => / -p /.test(c) || c.startsWith('codex exec')),
    [],
  );
});

test('signed in fails with the CLI text and a login fix', async () => {
  const { user } = harness({
    'claude --version': ok('2.1.331'),
    'claude auth status': { code: 1, stdout: '', stderr: 'Not logged in. Run claude auth login.' },
    'codex --version': ok('0.9.0'),
    'codex login status': { code: 1, stdout: '', stderr: 'Not logged in' },
    'pi --version': ok('1.6.0'),
    'pi --list-models': ok('provider model\n'),
  });
  const env = await user.environment();
  assert.equal(check(env, 'claude', 'signed_in').ok, false);
  assert.equal(check(env, 'claude', 'signed_in').error, 'Not logged in. Run claude auth login.');
  assert.equal(check(env, 'claude', 'signed_in').fix, 'claude auth login');
  assert.equal(check(env, 'codex', 'signed_in').error, 'Not logged in');
  assert.equal(check(env, 'codex', 'signed_in').fix, 'codex login');
  assert.equal(check(env, 'pi', 'signed_in').ok, false);
  assert.match(check(env, 'pi', 'signed_in').fix!, /API key/);
});

test('ANTHROPIC_API_KEY counts as Claude signed in and skips auth status', async () => {
  const { user, calls } = harness(
    { 'claude --version': ok('2.1.331'), 'claude auth status': { code: 1, stdout: '', stderr: 'no' } },
    { env: { ANTHROPIC_API_KEY: 'sk-test' } },
  );
  const env = await user.environment();
  assert.equal(check(env, 'claude', 'signed_in').ok, true);
  assert.equal(check(env, 'claude', 'signed_in').detail, 'ANTHROPIC_API_KEY is set');
  assert.ok(!calls.includes('claude auth status'));
});

test('a CLI that is not installed fails both free checks with the install fix', async () => {
  const { user } = harness({
    'claude --version': missing,
    'claude auth status': missing,
    'codex --version': missing,
    'codex login status': missing,
    'pi --version': missing,
    'pi --list-models': missing,
  });
  const env = await user.environment();
  assert.equal(check(env, 'claude', 'installed').ok, false);
  assert.equal(check(env, 'claude', 'installed').fix, 'npm i -g @anthropic-ai/claude-code');
  assert.equal(check(env, 'claude', 'installed').error, 'spawn ENOENT');
  assert.equal(check(env, 'claude', 'signed_in').ok, false);
  assert.equal(check(env, 'claude', 'signed_in').fix, 'npm i -g @anthropic-ai/claude-code');
  assert.equal(check(env, 'codex', 'installed').fix, 'npm i -g @openai/codex');
  assert.equal(check(env, 'pi', 'signed_in').ok, false);
});

test('the responds test runs one one-word call on the cheapest model of each provider', async () => {
  const { user, calls } = harness(
    {
      'claude -p Reply with one word: ok --model claude-haiku-5-5': ok('ok\n'),
      'codex exec --skip-git-repo-check -m gpt-6-mini Reply with one word: ok': ok('ok\n'),
      'pi --list-models': ok(PI_TABLE),
      'pi -p Reply with one word: ok --model anthropic/claude-haiku-5-5': ok('Ok'),
    },
    { codexModel: 'gpt-6-mini' },
  );
  for (const p of ['claude', 'codex', 'pi']) {
    const result = await user.testProvider(p);
    assert.equal(result.name, 'responds');
    assert.equal(result.ok, true, p);
    assert.match(result.cost_note!, /fraction of a cent/);
  }
  assert.equal(calls.filter((c) => / -p /.test(c) || c.startsWith('codex exec')).length, 3);
  await assert.rejects(user.testProvider('gemini'));
});

test('a failed responds test returns the error text unchanged, with a fix', async () => {
  const text = 'API Error: 401 {"type":"authentication_error"}\n  at line 2';
  const { user } = harness({
    'claude -p Reply with one word: ok --model claude-haiku-5-5': { code: 1, stdout: '', stderr: text },
    'codex exec --skip-git-repo-check Reply with one word: ok': missing,
    'pi --list-models': ok(PI_TABLE),
    'pi -p Reply with one word: ok --model anthropic/claude-haiku-5-5': {
      code: 1,
      stdout: '',
      stderr: '',
      stopped: 'timeout',
    },
  });
  const claude = await user.testProvider('claude');
  assert.equal(claude.ok, false);
  assert.equal(claude.error, text);
  assert.equal(claude.fix, 'claude auth login');
  const codex = await user.testProvider('codex');
  assert.equal(codex.fix, 'npm i -g @openai/codex');
  const pi = await user.testProvider('pi');
  assert.equal(pi.ok, false);
  assert.match(pi.error!, /No answer within 60 seconds/);
});
