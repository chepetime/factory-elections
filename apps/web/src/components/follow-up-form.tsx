'use client';
// Follow up on a task whose PR is open: pick the agent and say what to do, or use the conflict
// preset. The agent continues the same branch and PR; the change waits for your approval again.
import { GitMerge, MessageSquarePlus } from 'lucide-react';
import { useActionState, useId, useState } from 'react';
import { conflictFollowUpNote } from '@factory/core';
import { followUpIssue, type ActionState } from '@/app/actions';
import { Button } from '@factory/ui/components/button';
import { Label } from '@factory/ui/components/label';
import { Textarea } from '@factory/ui/components/textarea';
import { cn } from '@factory/ui/lib/utils';

export function FollowUpForm({
  project,
  issueKey,
  agents,
  defaultAgent,
  base,
  open: startOpen = false,
}: {
  project: string;
  issueKey: string;
  agents: { id: string; name: string }[];
  defaultAgent?: string;
  /** The PR's base branch, for the conflict preset. */
  base: string;
  open?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [kind, setKind] = useState<'custom' | 'conflicts'>('custom');
  const [note, setNote] = useState('');
  const [agent, setAgent] = useState(defaultAgent ?? agents[0]?.id ?? '');
  const [state, action, pending] = useActionState<ActionState, FormData>(followUpIssue, {});
  const noteId = useId();
  const agentId = useId();
  const pick = (next: 'custom' | 'conflicts') => {
    setKind(next);
    setNote(next === 'conflicts' ? conflictFollowUpNote(base) : '');
  };

  if (!open)
    return (
      <div id="follow-up" className="mt-3 flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <MessageSquarePlus aria-hidden className="size-4" /> Follow up
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(true);
            pick('conflicts');
          }}
        >
          <GitMerge aria-hidden className="size-4" /> Resolve merge conflicts
        </Button>
        {state.message && <p className="text-sm text-muted-foreground">{state.message}</p>}
      </div>
    );

  return (
    <form id="follow-up" action={action} className="mt-3 rounded-xl border bg-card p-4 shadow-xs">
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="key" value={issueKey} />
      <input type="hidden" name="kind" value={kind} />
      <p className="text-sm font-medium">Follow up on the open pull request</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        The agent continues the same branch and PR. Its change waits for your approval before the PR is
        updated.
      </p>
      <div className="mt-3 inline-flex rounded-lg border p-0.5" role="group" aria-label="Follow-up kind">
        {(
          [
            ['custom', 'Your instructions'],
            ['conflicts', 'Resolve merge conflicts'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => pick(value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-sm focus-visible:outline-2 focus-visible:outline-ring',
              kind === value ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr]">
        <div>
          <Label htmlFor={agentId}>Agent</Label>
          <select
            id={agentId}
            name="agent"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={noteId}>Instructions</Label>
          <Textarea
            id={noteId}
            name="note"
            rows={3}
            value={note}
            required
            placeholder="What should the agent do on this PR?"
            onChange={(e) => setNote(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !note.trim() || !agent}>
          {pending ? 'Queuing…' : 'Start follow-up'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <span
          role="status"
          className={cn('text-sm', state.error ? 'text-destructive' : 'text-muted-foreground')}
        >
          {state.error ?? state.message}
        </span>
      </div>
    </form>
  );
}
