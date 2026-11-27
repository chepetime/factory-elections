'use client';
// The ticket header's button that shows or hides the right sidebar. The choice is saved in the user
// settings (`tasks.details_pane`), so it holds across reloads, tickets and projects.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { updateUserSettings } from '@/app/actions';
import { DETAILS_PANE_KEY, TaskDetailsToggleButton } from '@/components/task-details-toggle-button';
import { useUserPreferences } from '@/components/user-preferences';

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** `shown`: the sidebar is on screen now. A `?panel=` link can show it while the saved setting is off. */
export function TaskDetailsToggle({ shown }: { shown: boolean }) {
  const { tasks } = useUserPreferences();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState<boolean | undefined>();
  const expanded = optimistic ?? shown;

  useEffect(() => setOptimistic(undefined), [shown]);

  const toggle = () => {
    const next = !expanded;
    setOptimistic(next);
    start(async () => {
      const saved = await updateUserSettings('tasks', { ...tasks, details_pane: next });
      if (saved.error) {
        setOptimistic(undefined);
        return;
      }
      // A `?panel=` link would keep the sidebar open after hiding it: drop it, keep the run.
      const rest = new URLSearchParams(params.toString());
      rest.delete('panel');
      router.replace(rest.size ? `${pathname}?${rest}` : pathname);
      router.refresh();
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === DETAILS_PANE_KEY && !typing(e.target)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return <TaskDetailsToggleButton expanded={expanded} pending={pending} onToggle={toggle} />;
}
