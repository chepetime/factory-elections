'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MemberUpdate, TeamMember } from '@/lib/team';

export function MemberBulkEditor({
  members,
  mode,
  pending,
  error,
  onSave,
  onCancel,
}: {
  members: TeamMember[];
  mode: 'edit' | 'merge';
  pending: boolean;
  error?: string;
  onSave: (update: MemberUpdate) => void;
  onCancel: () => void;
}) {
  const [changeTeam, setChangeTeam] = useState(false);
  const [changeTags, setChangeTags] = useState(false);
  const [team, setTeam] = useState('');
  const [tags, setTags] = useState('');
  const [primary, setPrimary] = useState(members[0]?.email ?? '');
  const emails = members.map((member) => member.email);
  return (
    <form
      className="flex shrink-0 flex-col gap-4 border-b bg-muted/30 px-5 py-4"
      aria-label={mode === 'edit' ? 'Edit selected members' : 'Merge selected members'}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(
          mode === 'merge'
            ? { kind: 'merge', emails, primary }
            : {
                kind: 'edit',
                emails,
                ...(changeTeam ? { team: team.trim() } : {}),
                ...(changeTags
                  ? {
                      tags: [
                        ...new Set(
                          tags
                            .split(',')
                            .map((tag) => tag.trim().replace(/^#/, ''))
                            .filter(Boolean),
                        ),
                      ],
                    }
                  : {}),
              },
        );
      }}
    >
      <h2 className="text-sm font-medium">
        {mode === 'edit' ? 'Edit' : 'Merge'} {members.length} selected members
      </h2>
      <fieldset disabled={pending} className="flex flex-wrap items-start gap-6 text-sm">
        {mode === 'merge' ? (
          <div className="flex max-w-xl flex-col gap-2">
            <label htmlFor="merge-primary" className="font-medium">
              Identity to keep
            </label>
            <select
              id="merge-primary"
              value={primary}
              onChange={(event) => setPrimary(event.target.value)}
              className="min-h-10 max-w-full rounded-md border bg-background px-3 focus-visible:outline-2 focus-visible:outline-ring"
            >
              {members.map((member) => (
                <option key={member.email} value={member.email}>
                  {member.name} ({member.email})
                </option>
              ))}
            </select>
            <p className="text-muted-foreground">
              Combine commit totals, date ranges, and tags into this identity. Its team is kept. The other
              identities will appear as aliases. Git history stays unchanged.
            </p>
            <p className="break-words text-xs text-muted-foreground">
              Merging: {members.map((member) => member.email).join(', ')}
            </p>
          </div>
        ) : (
          <>
            <div className="flex w-64 flex-col gap-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={changeTeam}
                  onChange={(event) => setChangeTeam(event.target.checked)}
                  className="size-4 accent-primary"
                />
                Replace team
              </label>
              <Input
                aria-label="Team for selected members"
                disabled={!changeTeam}
                maxLength={40}
                value={team}
                onChange={(event) => setTeam(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Leave empty to remove the team.</p>
            </div>
            <div className="flex w-80 max-w-full flex-col gap-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={changeTags}
                  onChange={(event) => setChangeTags(event.target.checked)}
                  className="size-4 accent-primary"
                />
                Replace tags
              </label>
              <Input
                aria-label="Tags for selected members, separated by commas"
                disabled={!changeTags}
                value={tags}
                onChange={(event) => setTags(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Separate tags with commas. Leave empty to remove all tags.
              </p>
            </div>
          </>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || (mode === 'edit' && !changeTeam && !changeTags)}>
          {pending ? 'Saving…' : mode === 'merge' ? 'Merge members' : 'Save changes'}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
