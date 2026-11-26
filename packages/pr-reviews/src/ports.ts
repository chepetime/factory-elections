// What a PR review needs from the backend's other services. The backend passes its real
// DelegationServer and MemoryService; tests pass fakes.
import type { McpEndpoint, SessionDigest, ToolUsage } from '@factory/core';

export interface ReviewGrantOptions {
  label: string;
  cwd: string;
  /** Review children may only read. */
  access: 'read-only';
  /** Dollars the children may spend in total. */
  budgetUsd: number;
}

/** An MCP endpoint the review agent may use to start children. */
export interface ReviewGrant {
  endpoint: McpEndpoint;
  /** Dollars the children reported so far. */
  spent(): number;
  revoke(): void;
}

export interface ReviewDelegation {
  /** Undefined when no children may start, e.g. at the depth limit. */
  grant(options: ReviewGrantOptions): ReviewGrant | undefined;
}

/** What agents learned about the repository, read before a turn and written after it. */
export interface ReviewMemory {
  prompt(project: string): Promise<string | undefined>;
  pruned(project: string): Promise<string[]>;
  toolUsage(project: string): Promise<ToolUsage>;
  record(project: string, digest: SessionDigest): Promise<void>;
  recordTools(project: string, offered: readonly string[], used: readonly string[]): Promise<void>;
}
