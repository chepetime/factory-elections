import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkEnvironment, checkRun, checkSandbox, factoryDataRoots } from '../src/index.ts';

const host = {
  PATH: '/usr/bin',
  HOME: '/home/me',
  TMPDIR: '/var/tmp/x/',
  S3_SECRET_ACCESS_KEY: 'storage-secret',
  AWS_ACCESS_KEY_ID: 'cloud-key',
  ANTHROPIC_API_KEY: 'sk-ant',
  OPENAI_API_KEY: 'sk-oai',
  GH_TOKEN: 'gh-token',
  KEEP_ME: 'yes',
};

test('a check never sees backend secrets or a model provider key', () => {
  const env = checkEnvironment(host);
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/home/me', TMPDIR: '/var/tmp/x/' });
});

test('a profile passes named variables and fixed values to checks, and the fixed ones win', () => {
  const env = checkEnvironment(host, { pass_env: ['KEEP_ME'], env: { CI: '1', PATH: '/custom' } });
  assert.equal(env.KEEP_ME, 'yes');
  assert.equal(env.CI, '1');
  assert.equal(env.PATH, '/custom');
  assert.equal(env.S3_SECRET_ACCESS_KEY, undefined);
});

test('a check runs with its worktree and temp folder writable, credentials unreadable, and one registry', () => {
  const extra = { allowed_domains: ['registry.example.com'], allow_write: ['/data/cache'] };
  const run = checkRun({
    cwd: '/work/t1',
    home: '/home/me',
    source: host,
    sandbox: extra,
    extraEnv: { PORT: '4000' },
  });
  assert.equal(run.env.PORT, '4000');
  assert.equal(run.env.S3_SECRET_ACCESS_KEY, undefined);
  assert.deepEqual(run.sandbox.allowedDomains, ['registry.npmjs.org', 'registry.example.com']);
  assert.ok(run.sandbox.allowWrite.includes('/work/t1'));
  assert.ok(run.sandbox.allowWrite.includes('/var/tmp/x/'));
  assert.ok(run.sandbox.allowWrite.includes('/data/cache'));
  assert.ok(run.sandbox.allowWrite.includes('/home/me/.npm'));
  assert.ok(run.sandbox.denyRead.includes('/home/me/.ssh'));
  assert.ok(run.sandbox.denyRead.includes('/home/me/.aws'));
  assert.deepEqual(run.sandbox, checkSandbox('/home/me', '/work/t1', extra, '/var/tmp/x/', host));
});

test('a check cannot read the factory data root, except its own worktree inside it', () => {
  const cwd = '/data/factory/app/worktrees/t1';
  const run = checkRun({ cwd, home: '/home/me', source: { ...host, FACTORY_ROOT: '/data/factory/' } });
  assert.deepEqual(run.sandbox.hideRoots, ['/home/me/.local/share/factory', '/data/factory']);
  assert.deepEqual(run.sandbox.reopen, [cwd]);
  assert.deepEqual(factoryDataRoots('/home/me', {}), ['/home/me/.local/share/factory']);
  // A relative root would hide the wrong folder, so the check does not run at all.
  assert.throws(() => factoryDataRoots('/home/me', { FACTORY_ROOT: 'data' }), /absolute/);
});
