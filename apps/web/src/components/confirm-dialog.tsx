'use client';
// In-app confirmation, in place of window.confirm: `const [confirm, dialog] = useConfirm()`, render
// `dialog`, then `if (await confirm({...}))`. Escape, the backdrop and Cancel all answer no.
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button } from '@factory/ui/components/button';

export type ConfirmRequest = {
  title: string;
  body: ReactNode;
  confirm: string;
  cancel?: string;
  /** Destructive actions get the red button. */
  tone?: 'default' | 'destructive';
};
export type Confirm = (request: ConfirmRequest) => Promise<boolean>;

export function useConfirm(): [Confirm, ReactNode] {
  const [request, setRequest] = useState<ConfirmRequest>();
  const [open, setOpen] = useState(false);
  const resolver = useRef<(answer: boolean) => void>(undefined);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<Confirm>((next) => {
    resolver.current?.(false);
    setRequest(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const answer = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = undefined;
    setOpen(false);
  };

  const dialog = (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) answer(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-[60] bg-black/40 motion-safe:transition-opacity motion-safe:duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0" />
        {/* Focus starts on the safe answer, so a stray Enter never starts or stops work. */}
        <AlertDialog.Popup
          initialFocus={cancelRef}
          className="fixed top-1/2 left-1/2 z-[60] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-5 text-foreground shadow-2xl outline-none motion-safe:transition-[opacity,scale] motion-safe:duration-150 data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0"
        >
          <AlertDialog.Title className="text-base font-semibold">{request?.title}</AlertDialog.Title>
          <AlertDialog.Description render={<div />} className="mt-2 text-sm text-muted-foreground">
            {request?.body}
          </AlertDialog.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button ref={cancelRef} variant="outline" onClick={() => answer(false)}>
              {request?.cancel ?? 'Cancel'}
            </Button>
            <Button
              variant={request?.tone === 'destructive' ? 'destructive' : 'default'}
              onClick={() => answer(true)}
            >
              {request?.confirm}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
  return [confirm, dialog];
}
