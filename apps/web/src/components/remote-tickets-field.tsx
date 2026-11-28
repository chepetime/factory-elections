'use client';
// A task's links to tickets in the project's own tracker: shown, removed and added in place. Each
// change saves the whole list and shows at once; a refused save puts the old list back.
import { Link2, Plus, X } from 'lucide-react';
import { useOptimistic, useState, useTransition, type FormEvent } from 'react';
import type { RemoteLink } from '@factory/core';
import { Button } from '@factory/ui/components/button';
import { Input } from '@factory/ui/components/input';
import { updateIssue } from '@/app/actions';
import { issuesChanged } from '@/lib/issues-changed';

export function RemoteTicketsField({
  project,
  issueKey,
  links,
}: {
  project: string;
  issueKey: string;
  links: RemoteLink[];
}) {
  const [shown, setShown] = useOptimistic(links);
  const [, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const save = (next: RemoteLink[]) =>
    start(async () => {
      setShown(next);
      const result = await updateIssue(project, issueKey, { remote_tickets: next });
      setError(result.error);
      if (!result.error) issuesChanged();
    });
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const key = String(form.get('key') ?? '').trim();
    const url = String(form.get('url') ?? '').trim();
    if (!key) return;
    if (shown.some((l) => l.key === key)) return setError(`${key} is already linked.`);
    save([...shown, { key, ...(url ? { url } : {}) }]);
    setAdding(false);
  };
  return (
    <div className="flex flex-col gap-2">
      {shown.length > 0 && (
        <ul aria-label="Linked remote tickets" className="flex flex-wrap gap-1.5">
          {shown.map((l) => (
            <li
              key={l.key}
              className="inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-xs"
            >
              <Link2 aria-hidden className="size-3 shrink-0 text-muted-foreground" />
              {l.url ? (
                <a href={l.url} target="_blank" rel="noreferrer" className="font-mono hover:underline">
                  {l.key}
                </a>
              ) : (
                <span className="font-mono">{l.key}</span>
              )}
              {l.title && <span className="max-w-60 truncate text-muted-foreground">{l.title}</span>}
              <button
                type="button"
                aria-label={`Unlink ${l.key}`}
                onClick={() => save(shown.filter((x) => x.key !== l.key))}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <Input
            name="key"
            required
            autoFocus
            placeholder="Key, e.g. #219 or PROJ-12"
            aria-label="Ticket key"
            className="h-8 w-48"
          />
          <Input
            name="url"
            type="url"
            placeholder="Link (optional)"
            aria-label="Ticket link"
            className="h-8 w-64"
          />
          <Button type="submit" size="sm">
            Link
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-ml-2 self-start text-muted-foreground"
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden />
          Link a ticket
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
