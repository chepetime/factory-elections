'use client';
// Toasts on Base UI (https://base-ui.com/react/components/toast), in the shadcn shape:
// `toast.add({ title, description, type })` from anywhere in the client, and one <Toaster /> in the
// root layout. `type` is success, info, warning, error or loading, and picks the icon.
import { Toast } from '@base-ui/react/toast';
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The app's toast manager: add, close, update and promise. */
export const toast = Toast.createToastManager();

const ICON = {
  success: { icon: CircleCheck, tone: 'text-emerald-600 dark:text-emerald-400' },
  info: { icon: Info, tone: 'text-sky-600 dark:text-sky-400' },
  warning: { icon: TriangleAlert, tone: 'text-amber-600 dark:text-amber-400' },
  error: { icon: CircleAlert, tone: 'text-destructive' },
  loading: { icon: LoaderCircle, tone: 'text-muted-foreground motion-safe:animate-spin' },
} as const;

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((t) => {
    const look = ICON[t.type as keyof typeof ICON];
    return (
      <Toast.Root
        key={t.id}
        toast={t}
        className={cn(
          'pointer-events-auto flex w-full items-start gap-3 rounded-xl border bg-popover px-4 py-3 text-popover-foreground shadow-lg',
          'transition-[opacity,transform] duration-200 data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 motion-reduce:transition-none',
          t.type === 'error' && 'border-destructive/40',
        )}
      >
        {look && <look.icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', look.tone)} />}
        <Toast.Content className="min-w-0 flex-1">
          {t.title && <Toast.Title className="text-sm font-medium">{t.title}</Toast.Title>}
          {t.description && (
            <Toast.Description className="mt-0.5 text-sm text-muted-foreground">
              {t.description}
            </Toast.Description>
          )}
          {t.actionProps && (
            <Toast.Action className="mt-2 inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium hover:bg-muted" />
          )}
        </Toast.Content>
        <Toast.Close
          aria-label="Close"
          className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden className="size-3.5" />
        </Toast.Close>
      </Toast.Root>
    );
  });
}

/** Renders the toasts, bottom right. Put it once in the root layout. */
export function Toaster() {
  return (
    <Toast.Provider toastManager={toast} limit={3} timeout={5000}>
      <Toast.Portal>
        <Toast.Viewport className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
