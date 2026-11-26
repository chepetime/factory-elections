'use client';
// Reloads the page when the task changes while a run works, for panels that show no live output.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { LivePoll } from '@/lib/task-chat';

export function RunWatch({
  project,
  id,
  version,
  everyMs = 3000,
}: {
  project: string;
  id: string;
  /** The page version from the server. A different version from the poll reloads the page. */
  version: string;
  everyMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const response = await fetch(`/api/projects/${project}/tasks/${id}/live`, { cache: 'no-store' });
          if (stopped) return;
          if (response.ok) {
            const live = (await response.json()) as LivePoll;
            if (!stopped && (live.version !== version || !live.busy)) router.refresh();
          }
        } catch {
          // A missed poll is harmless; the next one tries again.
        }
      }
      if (!stopped) timer = setTimeout(poll, everyMs);
    };
    timer = setTimeout(poll, everyMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [project, id, version, everyMs, router]);
  return null;
}
