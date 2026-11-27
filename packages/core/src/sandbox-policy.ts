// The OS sandbox rules for code a coder wrote or may have changed. One module, two readers: the
// coder's Bash sandbox (adapters-claude `sandboxFor`) and the checks the factory itself runs on
// the coder's worktree (test, full_check, runtime_check, setup; adapters-process `runShell`).
// A check runs the coder's code, so it gets the coder's rules, not the backend's.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkEnvironment } from './agent-env.ts';

/** Package registries a sandboxed run may reach, so it can update a lockfile. */
export const SANDBOX_ALLOWED_DOMAINS: readonly string[] = ['registry.npmjs.org'];

/** pnpm 12 locks its store under /tmp (not $TMPDIR); without it every install fails. */
export function pnpmLockDirs(uid: number = process.getuid?.() ?? 0): string[] {
  return ['/private/tmp', '/tmp'].map((dir) => `${dir}/pnpm-store-operation-locks-${uid}`);
}

/** Credential locations a sandboxed run must not read. */
export function sandboxDenyRead(home: string): string[] {
  return [
    join(home, '.ssh'),
    join(home, '.npmrc'),
    join(home, '.aws'),
    join(home, '.config', 'gh'),
    join(home, 'Library', 'Keychains'),
  ];
}

/** Where a sandboxed run may write besides its working directory: package-manager caches. */
export function sandboxAllowWrite(home: string, extra: readonly string[] = []): string[] {
  return [
    join(home, 'Library', 'pnpm'),
    join(home, 'Library', 'Caches', 'pnpm'),
    join(home, '.npm'),
    join(home, '.cache'),
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
  allowWrite: string[];
  allowedDomains: string[];
}

/** The sandbox for a check in `cwd`: the coder's rules, with the worktree writable. */
export function checkSandbox(
  home: string,
  cwd: string,
  extra?: SandboxExtra,
  tmpDir?: string,
): CheckSandbox {
  return {
    denyRead: sandboxDenyRead(home),
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
  sandbox?: (SandboxExtra & { pass_env?: readonly string[]; env?: Readonly<Record<string, string>> }) | undefined;
  cwd: string;
  source?: NodeJS.ProcessEnv;
  home?: string;
  extraEnv?: Record<string, string>;
}): CheckRun {
  const source = options.source ?? process.env;
  return {
    env: { ...checkEnvironment(source, options.sandbox), ...(options.extraEnv ?? {}) },
    sandbox: checkSandbox(options.home ?? homedir(), options.cwd, options.sandbox, source.TMPDIR),
  };
}
