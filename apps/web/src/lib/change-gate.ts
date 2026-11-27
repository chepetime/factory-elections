// Polling by version: ask the backend's cheap write counter (/api/versions) often, and load a full
// list only when the counter for what it shows moved. The backend counts its own writes only, so a
// list still reloads once a minute in case another process (the CLI) wrote directly.
export interface Versions {
  boot: string;
  projects: Record<string, number>;
}

/** What a list depends on: one project's counter, or every project's. */
export function stamp(versions: Versions, project?: string): string {
  const count = project
    ? (versions.projects[project] ?? 0)
    : Object.values(versions.projects).reduce((sum, n) => sum + n, 0);
  return `${versions.boot}:${count}`;
}

/**
 * Remembers the counter at the last load; `due` answers whether a list must be fetched now. The
 * caller loads once on its own at start, so the first answer only records the counter.
 */
export function changeGate(fullEveryMs = 60_000) {
  let loaded: string | undefined;
  let loadedAt = Date.now();
  let first = true;
  return {
    async due(project?: string): Promise<boolean> {
      const now = Date.now();
      const response = await fetch('/api/versions', { cache: 'no-store' }).catch(() => undefined);
      const versions = response?.ok ? ((await response.json()) as Versions) : undefined;
      // Without versions (an older backend, or it is down) every poll loads, as before.
      if (!versions) return true;
      const current = stamp(versions, project);
      if (first) {
        first = false;
        loaded = current;
        return false;
      }
      if (current === loaded && now - loadedAt < fullEveryMs) return false;
      loaded = current;
      loadedAt = now;
      return true;
    },
  };
}
