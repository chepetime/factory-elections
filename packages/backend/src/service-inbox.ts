// The inbox: what needs a person across projects, and the items a person dismissed.
// BackendService methods of the same names call these.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { inboxItems, type InboxItem, foreignLockInboxItems, recoveryInboxItems } from '@factory/core';
import type { BackendService } from './service.ts';

export function inboxPath(s: BackendService): string {
  return join(s.root, 'inbox', 'dismissed.json');
}
export async function dismissed(s: BackendService): Promise<Record<string, string>> {
  try {
    return (await s.storage.readDocument(s.inboxPath())) as Record<string, string>;
  } catch {
    return {};
  }
}
/** Everything that waits on the human, across projects, oldest first. */
export async function inbox(s: BackendService): Promise<{ items: InboxItem[]; dismissed: number }> {
  const dismissed = await s.dismissed();
  const items: InboxItem[] = [];
  for (const { name } of await s.projects.list()) {
    const [tasks, features, reviews] = await Promise.all([
      s.tasks.list(name).catch(() => []),
      s.features.all(name).catch(() => []),
      s.reviews.waiting(name).catch(() => []),
    ]);
    const tending = await s.tending.waiting(name, tasks).catch(() => []);
    const reviewLoops = await s.reviewLoop.waiting(name, tasks).catch(() => []);
    items.push(...inboxItems({ project: name, tasks, features, reviews, tending, reviewLoops }));
  }
  items.push(
    ...recoveryInboxItems(s.recovery),
    ...foreignLockInboxItems([...s.executor.foreignLocks.values()]),
  );
  const open = items.filter((i) => !dismissed[i.id]);
  return {
    items: open.sort((a, b) => a.since.localeCompare(b.since)),
    dismissed: items.length - open.length,
  };
}
/** Hides an inbox item until it waits again for a new reason. */
export async function dismissInbox(s: BackendService, raw: unknown): Promise<void> {
  const { id } = z.object({ id: z.string().min(1).max(400) }).parse(raw);
  if (!s.storage.config) await mkdir(join(s.root, 'inbox'), { recursive: true });
  await s.storage.writeDocument(s.inboxPath(), {
    ...(await s.dismissed()),
    [id]: new Date().toISOString(),
  });
}
