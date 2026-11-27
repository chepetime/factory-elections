import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  domainAllowed,
  runShell,
  sandboxedCommand,
  sandboxUnavailable,
  seatbeltProfile,
  startDomainProxy,
  type ShellSandbox,
} from '../src/index.ts';

const policy: ShellSandbox = {
  denyRead: ['/home/me/.ssh', '/home/me/.aws'],
  allowWrite: ['/work/t1', '/home/me/.npm'],
  allowedDomains: ['registry.npmjs.org'],
};

test('the generated profile denies writes outside the allowed paths, credential reads and the outside network', () => {
  const profile = seatbeltProfile(policy);
  assert.match(profile, /\(deny file-write\*\)/);
  assert.match(
    profile,
    /\(allow file-write\* [^\n]*\(subpath "\/work\/t1"\)[^\n]*\(subpath "\/home\/me\/\.npm"\)/,
  );
  assert.match(profile, /\(deny network\*\)/);
  assert.match(profile, /\(allow network-outbound \(remote ip "localhost:\*"\)\)/);
  assert.match(profile, /\(allow network-bind \(local ip "localhost:\*"\)\)/);
  assert.doesNotMatch(profile, /network-outbound \(remote ip "\*/);
  // Denies come last, so an allowed write path cannot reopen a credential folder.
  const lastDeny = profile.lastIndexOf('(deny file-read* file-write*');
  assert.ok(lastDeny > profile.lastIndexOf('(allow'));
  assert.match(profile.slice(lastDeny), /subpath "\/home\/me\/\.ssh"\).*subpath "\/home\/me\/\.aws"/);
});

test('paths are escaped, so a path cannot add rules', () => {
  const profile = seatbeltProfile({ ...policy, allowWrite: ['/w") (allow default) ("'] });
  assert.ok(profile.includes('(subpath "/w\\") (allow default) (\\"")'));
});

test('the command runs under sandbox-exec with the profile and the original shell command', () => {
  const { file, args } = sandboxedCommand('pnpm test', policy);
  assert.equal(file, '/usr/bin/sandbox-exec');
  assert.equal(args[0], '-p');
  assert.equal(args[1], seatbeltProfile(policy));
  assert.deepEqual(args.slice(2), ['/bin/sh', '-c', 'pnpm test']);
});

test('domains match exactly or by a wildcard for subdomains only', () => {
  assert.ok(domainAllowed('registry.npmjs.org', ['registry.npmjs.org']));
  assert.ok(domainAllowed('Registry.npmjs.org.', ['registry.npmjs.org']));
  assert.ok(!domainAllowed('evil.example.com', ['registry.npmjs.org']));
  assert.ok(!domainAllowed('registry.npmjs.org.evil.com', ['registry.npmjs.org']));
  assert.ok(domainAllowed('a.example.com', ['*.example.com']));
  assert.ok(!domainAllowed('example.com', ['*.example.com']));
});

async function connectVia(port: number, target: string): Promise<string> {
  const socket = connect(port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  const [chunk] = (await once(socket, 'data')) as [Buffer];
  socket.destroy();
  return chunk.toString().split('\r\n')[0]!;
}

test('the proxy refuses hosts outside the allowlist and ports other than 443', async (t) => {
  let proxy;
  try {
    proxy = await startDomainProxy(['registry.npmjs.org']);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return t.skip('cannot listen here (EPERM)');
    throw error;
  }
  try {
    assert.match(await connectVia(proxy.port, 'evil.example.com:443'), /403/);
    assert.match(await connectVia(proxy.port, 'registry.npmjs.org:22'), /403/);
    assert.match(await connectVia(proxy.port, '169.254.169.254:443'), /403/);
  } finally {
    await proxy.close();
  }
});

test('a sandboxed command without an explicit environment does not run', async () => {
  const lines: string[] = [];
  const result = await runShell('echo ran', { sandbox: policy, onOutput: (chunk) => lines.push(chunk) });
  assert.equal(result.code, 126);
  assert.doesNotMatch(result.stdout, /ran/);
  assert.match(lines.join(''), /not run/);
});

test('when no sandbox can start, a sandboxed command is refused rather than run open', async (t) => {
  const why = await sandboxUnavailable();
  if (!why) return t.skip('a sandbox is available here; the refusal needs a host without one');
  const dir = await mkdtemp(join(tmpdir(), 'factory-sbx-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const marker = join(dir, 'ran');
  const result = await runShell(`touch ${marker}`, {
    cwd: dir,
    env: { PATH: '/usr/bin:/bin' },
    sandbox: policy,
  });
  assert.equal(result.code, 126);
  assert.match(result.stderr, /not run: /);
  await assert.rejects(stat(marker), 'the command did not run');
});

test('in a real OS sandbox a check cannot see backend variables, read credentials, write elsewhere or reach other hosts', async (t) => {
  const why = await sandboxUnavailable();
  if (why) return t.skip(`no OS sandbox here: ${why}`);
  const dir = await mkdtemp(join(tmpdir(), 'factory-sbx-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  const work = join(dir, 'work');
  const outside = join(dir, 'outside');
  await mkdir(join(home, '.ssh'), { recursive: true });
  await mkdir(work);
  await mkdir(outside);
  await writeFile(join(home, '.ssh', 'id'), 'private-key');
  const sandbox: ShellSandbox = {
    denyRead: [join(home, '.ssh')],
    allowWrite: [work],
    allowedDomains: ['registry.npmjs.org'],
  };
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
  const exec = (command: string) => runShell(command, { cwd: work, env, sandbox, timeoutMs: 20_000 });

  process.env.FACTORY_TEST_STORAGE_KEY = 'backend-secret';
  t.after(() => void delete process.env.FACTORY_TEST_STORAGE_KEY);
  assert.equal((await exec('echo "key=[$FACTORY_TEST_STORAGE_KEY]"')).stdout.trim(), 'key=[]');
  assert.notEqual((await exec(`cat ${join(home, '.ssh', 'id')}`)).code, 0, 'a denied path is unreadable');
  assert.equal((await exec('touch inside.txt')).code, 0, 'the worktree is writable');
  assert.notEqual((await exec(`touch ${join(outside, 'x')}`)).code, 0, 'other paths are read-only');
  const net = await exec(
    `${process.execPath} -e "fetch('https://example.com').then(()=>process.exit(0),()=>process.exit(7))"`,
  );
  assert.notEqual(net.code, 0, 'a host outside the allowlist is unreachable');
});
