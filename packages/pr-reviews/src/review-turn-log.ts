// Facts read from a review turn's stream-json log: tools offered, permission mode, and why a
// turn left no report.
import { type AgentEvent } from '@factory/core';

/** Tool results that say a permission check refused the call, not that the tool failed. */
export const PERMISSION_REFUSAL =
  /requested permissions|haven't granted|requires approval|permission (?:was )?denied/i;

/**
 * Why a finished review turn left no usable report, in words for the ticket: stopped, failed, a
 * report that does not parse, or calls that a permission check refused (saving the report among them).
 */
export function missingReportReason(
  events: readonly AgentEvent[],
  turn: { exit: string; stopped: boolean; payloadError?: string; permissionMode?: string | undefined },
): string {
  if (turn.stopped) return 'The review was stopped.';
  if (turn.exit !== '0') return 'The review turn failed before it saved a report.';
  if (turn.payloadError) return `The saved report is not valid: ${turn.payloadError}`;
  const refused = events.filter(
    (e): e is Extract<AgentEvent, { type: 'tool-result' }> =>
      e.type === 'tool-result' && !e.ok && PERMISSION_REFUSAL.test(e.text),
  );
  const report = refused.some((e) => /payload\.json/.test(e.text));
  if (refused.length)
    return `${report ? 'The agent was refused permission to save its report' : 'The agent ended without a report'}; ${refused.length} of its tool ${refused.length === 1 ? 'calls was' : 'calls were'} refused by a permission check. The review turn ran in ${turn.permissionMode ? `${turn.permissionMode} permission mode` : 'an unknown permission mode'}, not with its intended permissions: see Settings, System status.`;
  return 'The review ended without saving a report.';
}

/** Built-in tools a Claude turn was offered, from its init line (MCP tools are not pruned). */
/** The permission mode a Claude turn ran in, from its init line. */
export function permissionModeOf(lines: readonly string[]): string | undefined {
  for (const line of lines.slice(0, 40)) {
    try {
      const e = JSON.parse(line) as { subtype?: unknown; permissionMode?: unknown };
      if (e.subtype === 'init' && typeof e.permissionMode === 'string') return e.permissionMode;
    } catch {
      // Not JSON.
    }
  }
  return undefined;
}

export function offeredTools(lines: readonly string[]): string[] {
  for (const line of lines.slice(0, 40)) {
    try {
      const e = JSON.parse(line) as { subtype?: unknown; tools?: unknown };
      if (e.subtype === 'init' && Array.isArray(e.tools))
        return (e.tools as unknown[]).filter(
          (t): t is string => typeof t === 'string' && !t.startsWith('mcp__'),
        );
    } catch {
      // Not JSON.
    }
  }
  return [];
}

/**
 * GitHub and git writes the agent may not make on its own. Kickoff and re-review turns get this
 * list; a message the user typed does not, so the user can still ask the agent to post.
 *
 * A hint, not a boundary: prefix patterns miss `git -C . push`, `env X=1 gh api` and any wrapped
 * command. The boundary is the OS sandbox every review turn runs in (see `spawnTurn`).
 */
export const AUTOMATED_TURN_DENY = [
  'Bash(gh pr review:*)',
  'Bash(gh pr comment:*)',
  'Bash(gh pr merge:*)',
  'Bash(gh pr close:*)',
  'Bash(gh pr edit:*)',
  'Bash(gh pr ready:*)',
  'Bash(gh issue comment:*)',
  'Bash(gh issue create:*)',
  'Bash(gh issue edit:*)',
  'Bash(gh api:*)',
  'Bash(git push:*)',
];
