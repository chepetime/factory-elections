'use client';
// Browser banners for new inbox items while the app tab is in the background. Off until the person
// turns it on in user settings and the browser grants permission. Items present on page load never
// raise a banner, only ones that arrive after.
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { inboxDestination } from '@/components/inbox';
import { useUserPreferences } from '@/components/user-preferences';
import type { InboxItem } from '@/lib/inbox';
import { changeGate } from '@/lib/change-gate';

const POLL_MS = 15_000;

export function InboxNotifier() {
  const { notifications } = useUserPreferences();
  const router = useRouter();
  const seen = useRef<Set<string> | undefined>(undefined);
  const muted = notifications.muted.join(',');

  useEffect(() => {
    if (!notifications.browser || typeof Notification === 'undefined') return;
    const mutedKinds = new Set(muted.split(',').filter(Boolean));
    let live = true;
    const poll = async () => {
      const r = await fetch('/api/inbox', { cache: 'no-store' }).catch(() => undefined);
      if (!r?.ok || !live) return;
      const { items } = (await r.json()) as { items: InboxItem[] };
      const first = seen.current === undefined;
      const known = (seen.current ??= new Set());
      for (const item of items) {
        if (known.has(item.id)) continue;
        known.add(item.id);
        if (first || mutedKinds.has(item.kind) || Notification.permission !== 'granted') continue;
        if (document.visibilityState === 'visible' && document.hasFocus()) continue;
        const banner = new Notification(item.title, {
          body: `${item.project}: ${item.action}`,
          tag: item.id,
        });
        banner.onclick = () => {
          window.focus();
          router.push(inboxDestination(item));
          banner.close();
        };
      }
    };
    void poll();
    // The inbox spans every project: reload it only when any project's write counter moved.
    const gate = changeGate();
    const timer = setInterval(
      () =>
        void gate.due().then(async (due) => {
          if (due) await poll();
        }),
      POLL_MS,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [notifications.browser, muted, router]);

  return null;
}
