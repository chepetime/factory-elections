// Counts writes per project in this backend, from the storage's write listener. Clients poll the
// counter (GetVersions) and reload a list only when it moved, instead of fetching every list.
import { randomUUID } from 'node:crypto';
import type { DataStorage } from '@factory/adapters-data';

export class ChangeCounter {
  private readonly counts = new Map<string, number>();
  /** A new id each start, so a client never mistakes a restarted backend's counters for old ones. */
  private readonly boot = randomUUID();
  constructor(storage: Pick<DataStorage, 'onChange'>) {
    storage.onChange((project) => this.counts.set(project, (this.counts.get(project) ?? 0) + 1));
  }
  versions(): { boot: string; projects: Record<string, number> } {
    return { boot: this.boot, projects: Object.fromEntries(this.counts) };
  }
}
