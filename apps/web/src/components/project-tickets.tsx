'use client';
// Remote Tickets: the project's own tracker (Jira, GitHub Issues, Linear…), listed by its configured
// command. JSON output becomes cards with search and label filters; any other output shows as text.
import { AlertCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@factory/ui/components/button';
import { TicketCards } from '@/components/remote-ticket-cards';
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
  const tickets = list?.tickets;
  return (
    <section className="flex h-full min-h-0 flex-col" aria-labelledby="tickets-heading" aria-busy={pending}>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-5">
        <div>
          <h1 id="tickets-heading" className="text-lg font-semibold">
            Remote Tickets
          </h1>
          <p className="text-sm text-muted-foreground">
            Open tickets in this project’s tracker
            {tickets ? ` · ${tickets.length}` : ''}
          </p>
        </div>
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
              Connect your project’s ticket tracker to list its tickets here.
            </p>
            <Link
              href={`/projects/${project}/settings`}
              className="rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            >
              Configure tickets
            </Link>
          </div>
        ) : tickets ? (
          <TicketCards tickets={tickets} raw={list.text} project={project} />
        ) : !list.text ? (
          <p className="text-sm text-muted-foreground">No open tickets. Refresh to check for new work.</p>
        ) : (
          <>
            <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
              The list command prints text, so it shows as is. For cards, make it print JSON, for example{' '}
              <code className="font-mono text-xs">gh issue list --json number,title,labels,state,url</code>,
              in{' '}
              <Link href={`/projects/${project}/settings`} className="underline underline-offset-4">
                ticket settings
              </Link>
              .
            </p>
            <pre className="w-max min-w-full font-mono text-sm leading-7">{list.text}</pre>
          </>
        )}
      </div>
    </section>
  );
}
