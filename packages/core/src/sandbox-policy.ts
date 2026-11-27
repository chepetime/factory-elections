// The OS sandbox rules for code a coder wrote or may have changed. One module, two readers: the
// coder's Bash sandbox (adapters-claude `sandboxFor`) and the checks the factory itself runs on
// the coder's worktree (test, full_check, runtime_check, setup; adapters-process `runShell`).
// A check runs the coder's code, so it gets the coder's rules, not the backend's.
import { checkEnvironment } from './agent-env.ts';

/** Package registries a sandboxed run may reach, so it can update a lockfile. */
export const SANDBOX_ALLOWED_DOMAINS: readonly string[] = ['registry.npmjs.org'];

/** pnpm 12 locks its store under /tmp (not $TMPDIR); without it every install fails. */
export function pnpmLockDirs(uid: number = process.getuid?.() ?? 0): string[] {
  return ['/private/tmp', '/tmp'].map((dir) => `${dir}/pnpm-store-operation-locks-${uid}`);
}

/**
 * Credential locations a sandboxed run must not read: the user's own, and the files in the factory
 * data roots that let a command act as the backend (its token, the storage and receipt keys).
 */
export function sandboxDenyRead(home: string, source: NodeJS.ProcessEnv = process.env): string[] {
  return [
    `${home}/.ssh`,
    `${home}/.npmrc`,
    `${home}/.aws`,
    `${home}/.config/gh`,
    `${home}/Library/Keychains`,
    ...factorySecretFiles(home, source),
  ];
}

/** The credential files in each factory data root. */
export function factorySecretFiles(home: string, source: NodeJS.ProcessEnv = process.env): string[] {
  return factoryDataRoots(home, source).flatMap((root) =>
    ['backend-token', 'storage.json', 'receipt-key'].map((file) => `${root}/${file}`),
  );
}

/** Where a sandboxed run may write besides its working directory: package-manager caches. */
export function sandboxAllowWrite(home: string, extra: readonly string[] = []): string[] {
  return [
    `${home}/Library/pnpm`,
    `${home}/Library/Caches/pnpm`,
    `${home}/.npm`,
    `${home}/.cache`,
    ...pnpmLockDirs(),
    ...extra,
  ];
}

/** A profile's `sandbox.allowed_domains` and `sandbox.allow_write`. */
export interface SandboxExtra {
  allowed_domains?: readonly string[] | undefined;
  allow_write?: readonly string[] | undefined;
}

/**
 * What an OS sandbox around a check command enforces. Reads are open except `denyRead`; writes
 * are denied except under `allowWrite`; the network reaches only `allowedDomains` (through a
 * filtering proxy) and the local machine's loopback (a runtime_check starts a dev server).
 */
export interface CheckSandbox {
  denyRead: string[];
  /** Folders closed for reading and writing except under `reopen`: the factory data root. */
  hideRoots: string[];
  /** Paths under a `hideRoots` folder the check still uses: its own worktree. */
  reopen: string[];
  allowWrite: string[];
  allowedDomains: string[];
}

/**
 * The factory's data roots: the default one and `FACTORY_ROOT`. They hold the backend token, the
 * storage credentials and other tasks' worktrees, so a check may not read them.
 */
export function factoryDataRoots(home: string, source: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [`${home}/.local/share/factory`];
  const root = source.FACTORY_ROOT;
  if (root && !root.startsWith('/'))
    throw new Error(`FACTORY_ROOT must be an absolute path to sandbox checks, and it is "${root}".`);
  if (root && root !== roots[0]) roots.push(root.replace(/\/+$/, ''));
  return roots;
}

/** The sandbox for a check in `cwd`: the coder's rules, with the worktree writable. */
export function checkSandbox(
  home: string,
  cwd: string,
  extra?: SandboxExtra,
  tmpDir?: string,
  source: NodeJS.ProcessEnv = process.env,
): CheckSandbox {
  return {
    denyRead: sandboxDenyRead(home, source),
    hideRoots: factoryDataRoots(home, source),
    reopen: [cwd],
    allowWrite: [cwd, ...(tmpDir ? [tmpDir] : []), ...sandboxAllowWrite(home, extra?.allow_write ?? [])],
    allowedDomains: [...SANDBOX_ALLOWED_DOMAINS, ...(extra?.allowed_domains ?? [])],
  };
}

/** What `runShell` needs to run one check the way the coder's own commands run. */
export interface CheckRun {
  /** The command's whole environment: the allowlist, never the backend's own. */
  env: Record<string, string>;
  sandbox: CheckSandbox;
}

/**
 * The environment and OS sandbox for a check command in `cwd` (setup, test, full_check,
 * runtime_check). Verification and PR tending both call this, so they run checks the same way.
 * `extraEnv` adds values a check needs for itself (runtime_check's PORT).
 */
export function checkRun(options: {
  /** A profile's `sandbox` block. */
  sandbox?:
    (SandboxExtra & { pass_env?: readonly string[]; env?: Readonly<Record<string, string>> }) | undefined;
  cwd: string;
  source?: NodeJS.ProcessEnv;
  /** The user's home directory: where the credential folders and caches are. */
  home: string;
  extraEnv?: Record<string, string>;
}): CheckRun {
  const source = options.source ?? process.env;
  return {
    env: { ...checkEnvironment(source, options.sandbox), ...options.extraEnv },
    sandbox: checkSandbox(options.home, options.cwd, options.sandbox, source.TMPDIR, source),
  };
}
