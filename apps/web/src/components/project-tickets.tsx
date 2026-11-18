'use client';
import { AlertCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { TicketList } from '@/lib/tickets';

export function ProjectTickets({
  project,
  list,
  error,
}: {
  project: string;
  list?: TicketList;
  error?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section className="flex h-full min-h-0 flex-col" aria-labelledby="tickets-heading" aria-busy={pending}>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-5">
        <h1 id="tickets-heading" className="text-lg font-semibold">
          Tickets
        </h1>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          <RefreshCw className={pending ? 'size-4 motion-safe:animate-spin' : 'size-4'} />
          {pending ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p>{error}</p>
              <Link href={`/projects/${project}/settings`} className="underline underline-offset-4">
                Check ticket settings
              </Link>
            </div>
          </div>
        ) : !list?.configured ? (
          <div className="flex flex-col items-start gap-3 text-sm">
            <p className="text-muted-foreground">
              Connect your project’s ticket tracker to list tickets here.
            </p>
            <Link
              href={`/projects/${project}/settings`}
              className="rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            >
              Configure tickets
            </Link>
          </div>
        ) : !list.text ? (
          <p className="text-sm text-muted-foreground">No open tickets. Refresh to check for new work.</p>
        ) : (
          <pre className="w-max min-w-full font-mono text-sm leading-7">{list.text}</pre>
        )}
      </div>
    </section>
  );
}
