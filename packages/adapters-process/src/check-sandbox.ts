// An OS sandbox for check commands that run a coder's code. macOS only (sandbox-exec, Seatbelt);
// anywhere else, or when the sandbox cannot start, the check fails: it is never run unsandboxed.
// Seatbelt cannot filter by host name, so the sandboxed command may reach only the loopback, and
// outside traffic goes through a small proxy here that lets through the allowed domains only.
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';

/** The rules of one sandbox. The same shape as `CheckSandbox` in `@factory/core`. */
export interface ShellSandbox {
  denyRead: readonly string[];
  allowWrite: readonly string[];
  allowedDomains: readonly string[];
}

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

const escapeScheme = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

/** The path as given and as the file system resolves it: Seatbelt matches resolved paths. */
function pathForms(path: string): string[] {
  const forms = new Set([path]);
  try {
    forms.add(realpathSync(path));
  } catch {
    // A path that does not exist yet is matched as given.
  }
  return [...forms];
}

const subpaths = (paths: readonly string[]) =>
  paths.flatMap(pathForms).map((p) => `(subpath "${escapeScheme(p)}")`);

/**
 * The Seatbelt profile for a sandbox. Later rules win: everything is allowed, then writes are
 * narrowed to `allowWrite` (and the devices a shell needs), the network to the loopback, and
 * `denyRead` paths are closed for reading and writing last.
 */
export function seatbeltProfile(sandbox: ShellSandbox): string {
  const devices = ['null', 'zero', 'tty', 'stdout', 'stderr', 'dtracehelper', 'autofs_nowait'].map(
    (name) => `(literal "/dev/${name}")`,
  );
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${[...devices, ...subpaths(sandbox.allowWrite)].join(' ')})`,
    // Unix sockets (a container daemon's, an agent's) are a way around the network rules.
    '(deny network*)',
    '(allow network-bind (local ip "localhost:*"))',
    '(allow network-inbound (local ip "localhost:*"))',
    '(allow network-outbound (remote ip "localhost:*"))',
  ];
  const denied = subpaths(sandbox.denyRead);
  if (denied.length) lines.push(`(deny file-read* file-write* ${denied.join(' ')})`);
  return lines.join('\n');
}

/** The command line that runs `command` under `sandbox`. */
export function sandboxedCommand(command: string, sandbox: ShellSandbox): { file: string; args: string[] } {
  return { file: SANDBOX_EXEC, args: ['-p', seatbeltProfile(sandbox), '/bin/sh', '-c', command] };
}

let probe: Promise<string | undefined> | undefined;

/** Why sandboxing is unavailable here, or undefined when a sandboxed command can start. */
export function sandboxUnavailable(): Promise<string | undefined> {
  probe ??= new Promise((resolve) => {
    if (process.platform !== 'darwin')
      return resolve(`check sandboxing needs macOS sandbox-exec, and this is ${process.platform}`);
    const child = spawn(SANDBOX_EXEC, ['-p', '(version 1)(allow default)', '/usr/bin/true'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolve(`${SANDBOX_EXEC} could not start: ${error.message}`));
    child.on('close', (code) =>
      resolve(code === 0 ? undefined : `${SANDBOX_EXEC} cannot start a sandbox here: ${stderr.trim()}`),
    );
  });
  return probe;
}

/** Whether `host` is one of `allowed`: an exact name, or `*.example.com` for its subdomains. */
export function domainAllowed(host: string, allowed: readonly string[]): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return allowed.some((entry) => {
    const pattern = entry.toLowerCase();
    return pattern.startsWith('*.') ? name.endsWith(pattern.slice(1)) : name === pattern;
  });
}

/**
 * A proxy on 127.0.0.1 that tunnels HTTPS (CONNECT, port 443) to the allowed domains and refuses
 * everything else, plain HTTP included. The sandboxed command reaches the outside only through it.
 */
export async function startDomainProxy(
  allowed: readonly string[],
): Promise<{ port: number; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((_request, response) => {
    response.writeHead(403, { 'content-type': 'text/plain' }).end('only HTTPS to allowed domains\n');
  });
  server.on('connect', (request, client: Socket, head) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    const target = request.url ?? '';
    const split = target.lastIndexOf(':');
    const host = split === -1 ? target : target.slice(0, split);
    const port = split === -1 ? 443 : Number(target.slice(split + 1));
    if (port !== 443 || !domainAllowed(host.replace(/^\[|\]$/g, ''), allowed)) {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = connect(port, host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => {
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      upstream.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** The proxy variables a sandboxed command needs; loopback traffic stays direct. */
export function proxyEnvironment(port: number): Record<string, string> {
  const url = `http://127.0.0.1:${port}`;
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
    // Node's own fetch and http clients read the proxy variables only with this.
    NODE_USE_ENV_PROXY: '1',
  };
}
