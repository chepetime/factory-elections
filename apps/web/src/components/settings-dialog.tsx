'use client';
// Route-backed settings dialog. Inside the app it opens over the current page (an intercepted
// route) and closes by going back; a direct visit shows it over the project home.
import { Dialog } from '@base-ui/react/dialog';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type SettingsDialogContext = {
  close: () => void;
  setDirty: (dirty: boolean) => void;
};

const Context = createContext<SettingsDialogContext | null>(null);

/** The enclosing settings dialog, or null when the settings render as a full page. */
export function useSettingsDialog() {
  return useContext(Context);
}

export const SettingsDialogTitle = Dialog.Title;

/**
 * `closeHref` is for a direct visit: there is no page to go back to, so closing navigates there.
 * Without it the dialog was opened from inside the app, and closing goes back.
 */
export function SettingsDialog({ closeHref, children }: { closeHref?: string; children: ReactNode }) {
  const router = useRouter();
  const dirty = useRef(false);
  // Read before the popup takes focus. The dialog unmounts on back navigation instead of closing,
  // so focus returns to the opener here.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
  useEffect(() => {
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener]);
  const close = useCallback(() => {
    if (dirty.current && !window.confirm('Discard your unsaved settings changes?')) return;
    if (closeHref) router.replace(closeHref, { scroll: false });
    else router.back();
  }, [closeHref, router]);
  const value = useMemo(
    () => ({
      close,
      setDirty: (next: boolean) => {
        dirty.current = next;
      },
    }),
    [close],
  );

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 motion-safe:transition-opacity motion-safe:duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0" />
        {/* Start on the section list, not on the first button: Enter there would start a paid run. */}
        <Dialog.Popup
          initialFocus={() =>
            document.querySelector<HTMLElement>('[role="dialog"] [role="tab"][data-active]')
          }
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground outline-none motion-safe:transition-[opacity,scale] motion-safe:duration-150 data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(44rem,calc(100dvh-4rem))] sm:w-[min(60rem,calc(100vw-4rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-2xl"
        >
          <Context.Provider value={value}>{children}</Context.Provider>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
