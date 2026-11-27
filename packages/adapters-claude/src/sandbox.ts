// The rules every Claude OS sandbox shares, whether it wraps a coder step or a PR review turn. Kept
// apart from index.ts and turn.ts, which import each other's exports, so both can use it.
import { homedir } from 'node:os';
import type { SandboxSettings } from '@anthropic-ai/claude-agent-sdk';
import { sandboxDenyRead as coreSandboxDenyRead, type HeadlessTurn } from '@factory/core';

/** Credential stores a sandboxed command may not read. The list lives in `@factory/core`. */
export function sandboxDenyRead(home: string = homedir()): string[] {
  return coreSandboxDenyRead(home);
}

/**
 * A sandbox a command cannot leave: it must run sandboxed (or the turn fails), the model cannot opt
 * a command out, and a sandboxed command is not auto-approved. Writes go only to `allowWrite` and
 * the network only to `allowedDomains`.
 */
export function baseSandbox(options: {
  allowWrite: readonly string[];
  allowedDomains: readonly string[];
  home?: string;
}): SandboxSettings {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: [...options.allowedDomains] },
    filesystem: {
      denyRead: sandboxDenyRead(options.home),
      allowWrite: [...options.allowWrite],
    },
  };
}

/**
 * The sandbox of a headless turn that asks for one (a PR review turn reads untrusted text): writes
 * only to `turn.sandbox.allowWrite`, and no network unless the turn names domains. The SDK takes it
 * as the `sandbox` option; the CLI as `--settings` (see `claudeCli.args`).
 */
export function turnSandbox(turn: HeadlessTurn, home?: string): SandboxSettings | undefined {
  if (!turn.sandbox) return undefined;
  return baseSandbox({
    allowWrite: turn.sandbox.allowWrite,
    allowedDomains: turn.sandbox.allowedDomains ?? [],
    ...(home ? { home } : {}),
  });
}
