import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentEnvironment, envNames, hostAgentSession } from '../src/index.ts';

const host = {
  PATH: '/bin',
  HOME: '/Users/me',
  LC_ALL: 'en_US.UTF-8',
  MISE_SHELL: 'zsh',
  ANTHROPIC_API_KEY: 'a-key',
  OPENAI_API_KEY: 'o-key',
  FACTORY_DATABASE_URL: 'postgres://secret',
  GITHUB_TOKEN: 'gh-token',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
  CLAUDECODE: '1',
  CLAUDE_CODE_SESSION_ID: 'parent',
  EXTRA: 'x',
};

test('an agent gets tool lookup and its own provider credential only', () => {
  assert.deepEqual(agentEnvironment('claude', host), {
    PATH: '/bin',
    HOME: '/Users/me',
    LC_ALL: 'en_US.UTF-8',
    MISE_SHELL: 'zsh',
    ANTHROPIC_API_KEY: 'a-key',
  });
  const codex = agentEnvironment('codex', host);
  assert.equal(codex.OPENAI_API_KEY, 'o-key');
  assert.equal(codex.ANTHROPIC_API_KEY, undefined);
  assert.equal(agentEnvironment('claude', host, ['EXTRA']).EXTRA, 'x');
});

test('allow lists keep valid names only', () => {
  assert.deepEqual(envNames(' A_1, bad-name ,,B '), ['A_1', 'B']);
  assert.deepEqual(envNames(undefined), []);
});

test('hostAgentSession names a Claude Code session that started the process, and nothing otherwise', () => {
  assert.equal(hostAgentSession({ CLAUDECODE: '1' }), 'claude-code');
  assert.equal(hostAgentSession({ CLAUDE_CODE_SESSION_ID: 's' }), 'claude-code');
  assert.equal(hostAgentSession({ PATH: '/bin' }), undefined);
});
