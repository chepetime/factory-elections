'use client';
// Route-backed settings dialog. Inside the app it opens over the current page (an intercepted
// route) and closes by going back; a direct visit shows it over the project home.
import { useConfirm } from '@/components/confirm-dialog';
import { Dialog, DialogContent, DialogTitle } from '@factory/ui/components/dialog';
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
  close: () => void | Promise<void>;
  setDirty: (dirty: boolean) => void;
};

const Context = createContext<SettingsDialogContext | null>(null);

/** The enclosing settings dialog, or null when the settings render as a full page. */
export function useSettingsDialog() {
  return useContext(Context);
}

export const SettingsDialogTitle = DialogTitle;

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
  const [confirm, confirmDialog] = useConfirm();
  const close = useCallback(async () => {
    if (
      dirty.current &&
      !(await confirm({
        title: 'Discard your changes?',
        body: 'Your unsaved settings changes will be lost.',
        confirm: 'Discard',
        cancel: 'Keep editing',
        tone: 'destructive',
      }))
    )
      return;
    if (closeHref) router.replace(closeHref, { scroll: false });
    else router.back();
  }, [closeHref, confirm, router]);
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {/* Start on the section list, not on the first button: Enter there would start a paid run. */}
      <DialogContent
        showCloseButton={false}
        initialFocus={() => document.querySelector<HTMLElement>('[role="dialog"] [role="tab"][data-active]')}
        // Full screen on phones; a large centred panel from sm up.
        className="inset-0 flex w-auto translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(44rem,calc(100dvh-4rem))] sm:w-[min(60rem,calc(100vw-4rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-2xl"
      >
        <Context.Provider value={value}>{children}</Context.Provider>
        {confirmDialog}
      </DialogContent>
    </Dialog>
  );
}
