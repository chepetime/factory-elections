'use client';
// :ProjectReadApi: client. Pending, empty and failed states are distinct.
import Link from 'next/link';
import { useEffect, useState } from 'react';

type State = { kind: 'loading' } | { kind: 'failed' } | { kind: 'loaded'; names: string[] };

export function ProjectSelector() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    fetch('/api/projects', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const body: unknown = await r.json();
        if (!Array.isArray(body)) throw new Error();
        return body.map((p) => String((p as { name: unknown }).name));
      })
      .then((names) => live && setState({ kind: 'loaded', names }))
      .catch(() => live && setState({ kind: 'failed' }));
    return () => {
      live = false;
    };
  }, []);
  if (state.kind === 'loading') return <p className="text-sm text-muted-foreground">Loading projects</p>;
  if (state.kind === 'failed') return <p className="text-sm text-destructive">Projects unavailable</p>;
  if (state.names.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No projects yet. Register one with{' '}
        <code>factory project add --name &lt;name&gt; --repo &lt;path&gt;</code>.
      </p>
    );
  return (
    <ul className="flex flex-wrap gap-2">
      {state.names.map((name) => (
        <li key={name}>
          <Link
            href={`/projects/${name}/tasks`}
            className="inline-block rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            {name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
