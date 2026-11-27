// Fix turns: when Factory's verification refuses an agent's change for a reason the agent can fix,
// the same session gets the failure and an instruction for it, instead of a person relaying it.
import { environmentFailure, type FactoryTool } from '@factory/core';
import { tail } from './support.ts';

/** Fix turns after the agent's own turn, before the task waits for a person. Each one costs a turn. */
export const AGENT_FIX_TURNS = 2;

const RULES = [
  'Fix it with new commits on this branch. Do not merge, rebase, pull or reset: Factory brings the base in for you.',
  'Do the work yourself in this turn; do not hand it to a child agent with delegate.',
  'Before you stop, commit and call the check_change tool, run the checks, and fix what they report.',
].join('\n');

/** What the agent should do about the failure, by the failure's own marker. */
function instruction(output: string): string {
  if (/\[change has \d+ non-test lines; limit is \d+/.test(output))
    return [
      'The change is too large for one pull request.',
      'Keep the smallest deployable part on this branch: it must build and pass its tests on its own.',
      'Remove the rest with a new commit, and keep the removed work out of this branch.',
      'Then comment on the task with what you removed, so a person can file it as a follow-up task.',
    ].join(' ');
  if (/\[the change weakens tests:/.test(output))
    return 'Fix the code, not the tests. Restore each test, skip or assertion the change removed or weakened. If a test is wrong, comment why and set the status to blocked; a person can allow test changes.';
  if (/\[verification left uncommitted changes:/.test(output))
    return 'Files changed after your turn ended, while Factory ran the checks. Stop every background process you started (watchers, test runs, child agents). Commit the changes you mean to keep. If a check command writes the files, add them to .gitignore.';
  if (/\[setup failed after the change/.test(output))
    return 'Setup failed after your change. Fix the dependency files (package.json, lockfile) so a clean install passes.';
  return 'Fix what fails. Read the output below from the end: the last failure markers name the step.';
}

/**
 * The message for a fix turn, or undefined when the agent cannot fix the failure: an environment
 * fault (a busy port, a missing tool, a profile pattern) needs a person to fix the machine.
 */
export function verificationSteer(
  output: string,
  environmentPatterns: readonly string[] = [],
): string | undefined {
  if (environmentFailure(output, environmentPatterns)) return undefined;
  return [
    'Factory verified your commits after your turn, and verification failed. This message is from Factory, not from a person.',
    '',
    instruction(output),
    '',
    RULES,
    '',
    'Verification output (tail):',
    '```',
    tail(output, 4000),
    '```',
  ].join('\n');
}

/** The agent's own run of Factory's change gates (size, tests) on its committed change. */
export function changeCheckTool(check: () => Promise<string | undefined>): FactoryTool {
  return {
    name: 'check_change',
    description:
      "Run Factory's change gates on your committed change, the way Factory runs them after your turn: " +
      'at most 400 non-test lines, and no weakened tests. Commit first; uncommitted edits do not count. ' +
      'It does not run the test commands; run those yourself.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async call() {
      const refused = await check();
      return refused
        ? { text: refused, isError: true }
        : { text: "The committed change passes the size and test gates. Run the project's checks too." };
    },
  };
}
