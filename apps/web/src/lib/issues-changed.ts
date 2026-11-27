// A browser event for "a task changed here": the sidebar reloads its task lists at once instead of
// at its next poll. Fire it after a mutation succeeds.
export const ISSUES_CHANGED = 'factory:issues-changed';

export function issuesChanged(): void {
  window.dispatchEvent(new Event(ISSUES_CHANGED));
}
