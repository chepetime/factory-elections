'use client';
// In-app confirmation, in place of window.confirm: `const [confirm, dialog] = useConfirm()`, render
// `dialog`, then `if (await confirm({...}))`. Escape, the backdrop and Cancel all answer no.
import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@factory/ui/components/alert-dialog';
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
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) answer(false);
      }}
    >
      {/* Focus starts on the safe answer, so a stray Enter never starts or stops work. */}
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>{request?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button ref={cancelRef} variant="outline" onClick={() => answer(false)}>
            {request?.cancel ?? 'Cancel'}
          </Button>
          <Button
            variant={request?.tone === 'destructive' ? 'destructive' : 'default'}
            onClick={() => answer(true)}
          >
            {request?.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return [confirm, dialog];
}
