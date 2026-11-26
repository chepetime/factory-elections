'use client';
// Edits a planned board before its approval. The backend checks the result: ids, blockers, cycles.
import { useState } from 'react';
import type { Ticket } from '@factory/core';
import { FeatureGate } from '@/components/feature-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Draft = Pick<Ticket, 'id' | 'title' | 'description' | 'size'> & {
  /** One acceptance check per line. */
  acceptance: string;
  /** Ticket ids, separated by commas. */
  blocked_by: string;
};
const SIZES: Ticket['size'][] = ['S', 'M', 'L'];
const parts = (text: string, separator: RegExp) =>
  text
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);

export function FeatureBoardEditor({
  project,
  id,
  tickets,
}: {
  project: string;
  id: string;
  tickets: Ticket[];
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    tickets.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      size: t.size,
      acceptance: t.acceptance.join('\n'),
      blocked_by: t.blocked_by.join(', '),
    })),
  );
  const change = (index: number, patch: Partial<Draft>) =>
    setDrafts((current) => current.map((d, n) => (n === index ? { ...d, ...patch } : d)));
  const payload = JSON.stringify(
    drafts.map((d) => ({
      id: d.id,
      title: d.title.trim(),
      description: d.description.trim(),
      size: d.size,
      acceptance: parts(d.acceptance, /\n/),
      blocked_by: parts(d.blocked_by, /,/),
    })),
  );
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">Edit tickets</summary>
      <ul className="mt-3 space-y-4">
        {drafts.map((d, index) => (
          <li key={d.id} className="space-y-2 border-t pt-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{d.id}</span>
              <Input
                aria-label={`${d.id} title`}
                value={d.title}
                onChange={(event) => change(index, { title: event.target.value })}
              />
              <select
                aria-label={`${d.id} size`}
                className="h-8 rounded-lg border bg-transparent px-2 text-sm"
                value={d.size}
                onChange={(event) => change(index, { size: event.target.value as Ticket['size'] })}
              >
                {SIZES.map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={drafts.length === 1}
                onClick={() => setDrafts((current) => current.filter((_, n) => n !== index))}
              >
                Remove
              </Button>
            </div>
            <Textarea
              aria-label={`${d.id} description`}
              rows={3}
              value={d.description}
              onChange={(event) => change(index, { description: event.target.value })}
            />
            <Textarea
              aria-label={`${d.id} acceptance checks, one on each line`}
              rows={2}
              value={d.acceptance}
              onChange={(event) => change(index, { acceptance: event.target.value })}
            />
            <Input
              aria-label={`${d.id} is blocked by these ticket ids, separated by commas`}
              placeholder="Blocked by, for example T1, T2"
              value={d.blocked_by}
              onChange={(event) => change(index, { blocked_by: event.target.value })}
            />
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <FeatureGate project={project} id={id} action="save-board" label="Save tickets" tickets={payload} />
      </div>
    </details>
  );
}
