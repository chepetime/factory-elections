'use client';
// Team screen: the repository's contributors as an editable table, filterable by team and tag,
// optionally grouped by team. Layout inspired by Affect UI's CRM screen
// (https://www.affectui.com/screens/crm); original implementation, no Affect UI source or assets.
import { Popover } from '@base-ui/react/popover';
import { Check, Plus, Search, Users, X } from 'lucide-react';
import { useMemo, useReducer, useRef, useState, useTransition } from 'react';
import { assignMember } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { teamEdits } from '@/lib/team-edits';
import type { TeamMember } from '@/lib/team';
import { cn } from '@/lib/utils';

const NO_TEAM = '\u0000none';
const PALETTE = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-lime-600',
  'bg-orange-500',
];

function color(team: string): string {
  let h = 0;
  for (const ch of team) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const popup =
  'z-50 w-64 rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg outline-none motion-safe:transition-opacity motion-safe:duration-100 data-starting-style:opacity-0 data-ending-style:opacity-0';
const option =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 pointer-coarse:py-3 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none';

function FilterButton({
  active,
  onClick,
  dot,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  dot?: string;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 pointer-coarse:py-3 text-left text-sm transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring',
        active && 'bg-background shadow-xs hover:bg-background',
      )}
    >
      {dot ? (
        <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden />
      ) : (
        <span className="size-2 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

export function TeamTable({ project, initial }: { project: string; initial: TeamMember[] }) {
  const [edits, dispatch] = useReducer(teamEdits, { members: initial, pending: {} });
  const { members, error } = edits;
  const inFlight = useRef(new Set<string>());
  const sequence = useRef(0);
  const [filter, setFilter] = useState<
    { kind: 'all' } | { kind: 'team'; team: string } | { kind: 'tag'; tag: string }
  >({
    kind: 'all',
  });
  const [query, setQuery] = useState('');
  const [grouped, setGrouped] = useState(true);
  const [, startTransition] = useTransition();

  const teams = useMemo(
    () => [...new Set(members.flatMap((m) => (m.team ? [m.team] : [])))].sort((a, b) => a.localeCompare(b)),
    [members],
  );
  const tags = useMemo(
    () => [...new Set(members.flatMap((m) => m.tags))].sort((a, b) => a.localeCompare(b)),
    [members],
  );

  const update = (email: string, team: string | undefined, nextTags: string[]) => {
    if (inFlight.current.has(email)) return;
    inFlight.current.add(email);
    const requestId = ++sequence.current;
    dispatch({ type: 'start', email, requestId, team, tags: nextTags });
    startTransition(async () => {
      try {
        const result = await assignMember(project, email, team, nextTags);
        dispatch({ type: 'settle', email, requestId, error: result.error });
      } catch {
        dispatch({ type: 'settle', email, requestId, error: 'Could not save this member. Try again.' });
      } finally {
        inFlight.current.delete(email);
      }
    });
  };

  const q = query.trim().toLowerCase();
  const visible = members.filter(
    (m) =>
      (filter.kind === 'all' ||
        (filter.kind === 'team' && (filter.team === NO_TEAM ? !m.team : m.team === filter.team)) ||
        (filter.kind === 'tag' && m.tags.includes(filter.tag))) &&
      (!q ||
        m.name.toLowerCase().includes(q) ||
        m.email.includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))),
  );
  const groups: [string, TeamMember[]][] = grouped
    ? [...teams, NO_TEAM]
        .map((t): [string, TeamMember[]] => [
          t,
          visible.filter((m) => (t === NO_TEAM ? !m.team : m.team === t)),
        ])
        .filter(([, ms]) => ms.length > 0)
    : [['', visible]];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-3">
        <h1 className="flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4 text-muted-foreground" aria-hidden />
          Team
          <span className="font-normal text-muted-foreground">· {project}</span>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Search members"
              placeholder="Search name, email or tag"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-60 pl-8"
            />
          </div>
          <Button variant="outline" size="sm" aria-pressed={grouped} onClick={() => setGrouped((g) => !g)}>
            {grouped ? 'Grouped by team' : 'Not grouped'}
          </Button>
        </div>
      </header>

      {error && (
        <p role="alert" className="border-b bg-destructive/5 px-5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <nav
          aria-label="Filter members"
          className="flex shrink-0 flex-col gap-4 overflow-y-auto border-r bg-muted/40 p-3 md:w-56 max-md:border-r-0 max-md:border-b"
        >
          <div className="flex flex-col gap-px">
            <FilterButton
              active={filter.kind === 'all'}
              onClick={() => setFilter({ kind: 'all' })}
              label="All members"
              count={members.length}
            />
          </div>
          <div className="flex flex-col gap-px">
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Teams</p>
            {teams.map((t) => (
              <FilterButton
                key={t}
                active={filter.kind === 'team' && filter.team === t}
                onClick={() => setFilter({ kind: 'team', team: t })}
                dot={color(t)}
                label={t}
                count={members.filter((m) => m.team === t).length}
              />
            ))}
            <FilterButton
              active={filter.kind === 'team' && filter.team === NO_TEAM}
              onClick={() => setFilter({ kind: 'team', team: NO_TEAM })}
              dot="bg-muted-foreground/30"
              label="No team"
              count={members.filter((m) => !m.team).length}
            />
          </div>
          {tags.length > 0 && (
            <div className="flex flex-col gap-px">
              <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Tags</p>
              {tags.map((t) => (
                <FilterButton
                  key={t}
                  active={filter.kind === 'tag' && filter.tag === t}
                  onClick={() => setFilter({ kind: 'tag', tag: t })}
                  label={`#${t}`}
                  count={members.filter((m) => m.tags.includes(t)).length}
                />
              ))}
            </div>
          )}
        </nav>

        <div className="min-h-0 flex-1 overflow-auto">
          {members.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-medium">No contributors yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                People appear here once the repository has commits.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No members match.</p>
          ) : (
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th className="px-5 py-2 font-medium">Member</th>
                  <th className="px-3 py-2 font-medium">Team</th>
                  <th className="px-3 py-2 font-medium">Tags</th>
                  <th className="px-3 py-2 text-right font-medium">Commits</th>
                  <th className="px-5 py-2 text-right font-medium">Last commit</th>
                </tr>
              </thead>
              {groups.map(([group, ms]) => (
                <tbody key={group || 'all'}>
                  {grouped && (
                    <tr>
                      <th
                        colSpan={5}
                        scope="colgroup"
                        className="bg-muted/50 px-5 py-1.5 text-xs font-medium"
                      >
                        <span className="inline-flex items-center gap-2">
                          <span
                            className={cn(
                              'size-2 rounded-full',
                              group === NO_TEAM ? 'bg-muted-foreground/30' : color(group),
                            )}
                            aria-hidden
                          />
                          {group === NO_TEAM ? 'No team' : group}
                          <span className="font-normal text-muted-foreground">{ms.length}</span>
                        </span>
                      </th>
                    </tr>
                  )}
                  {ms.map((m) => (
                    <tr
                      key={m.email}
                      aria-busy={Boolean(edits.pending[m.email])}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="px-5 py-2">
                        <div className="flex items-center gap-3">
                          <span
                            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
                            aria-hidden
                          >
                            {initials(m.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{m.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <fieldset
                          disabled={Boolean(edits.pending[m.email])}
                          aria-label={`Team for ${m.name}`}
                        >
                          <TeamPicker
                            member={m}
                            teams={teams}
                            onChange={(team) => update(m.email, team, m.tags)}
                          />
                        </fieldset>
                      </td>
                      <td className="px-3 py-2">
                        <fieldset
                          disabled={Boolean(edits.pending[m.email])}
                          aria-label={`Tags for ${m.name}`}
                        >
                          <TagEditor
                            member={m}
                            known={tags}
                            onChange={(next) => update(m.email, m.team, next)}
                          />
                        </fieldset>
                        {edits.pending[m.email] && (
                          <span role="status" className="text-xs text-muted-foreground">
                            Saving…
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.commits}</td>
                      <td className="px-5 py-2 text-right whitespace-nowrap text-muted-foreground">
                        {date(m.lastCommit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamPicker({
  member,
  teams,
  onChange,
}: {
  member: TeamMember;
  teams: string[];
  onChange: (team: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const pick = (team: string | undefined) => {
    onChange(team);
    setOpen(false);
    setText('');
  };
  const typed = text.trim();
  const matches = teams.filter((t) => t.toLowerCase().includes(typed.toLowerCase()));
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Team for ${member.name}`}
        className={cn(
          "relative inline-flex max-w-40 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-[''] transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
          !member.team && 'border-dashed text-muted-foreground',
        )}
      >
        {member.team ? (
          <>
            <span className={cn('size-1.5 shrink-0 rounded-full', color(member.team))} aria-hidden />
            <span className="truncate">{member.team}</span>
          </>
        ) : (
          'Assign'
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className={popup}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (typed) pick(typed);
              }}
            >
              <Input
                autoFocus
                value={text}
                maxLength={40}
                onChange={(e) => setText(e.target.value)}
                placeholder="Find or create a team"
                aria-label="Team name"
                className="h-8"
              />
            </form>
            <div className="mt-1 flex max-h-56 flex-col overflow-y-auto">
              {matches.map((t) => (
                <button key={t} type="button" className={option} onClick={() => pick(t)}>
                  <span className={cn('size-2 rounded-full', color(t))} aria-hidden />
                  <span className="flex-1 truncate">{t}</span>
                  {t === member.team && <Check className="size-3.5" aria-hidden />}
                </button>
              ))}
              {typed && !teams.some((t) => t.toLowerCase() === typed.toLowerCase()) && (
                <button type="button" className={option} onClick={() => pick(typed)}>
                  <Plus className="size-3.5" aria-hidden /> Create “{typed}”
                </button>
              )}
              {member.team && (
                <button
                  type="button"
                  className={cn(option, 'text-muted-foreground')}
                  onClick={() => pick(undefined)}
                >
                  <X className="size-3.5" aria-hidden /> Remove from {member.team}
                </button>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TagEditor({
  member,
  known,
  onChange,
}: {
  member: TeamMember;
  known: string[];
  onChange: (tags: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const typed = text.trim().replace(/^#/, '');
  const add = (tag: string) => {
    if (tag && !member.tags.includes(tag)) onChange([...member.tags, tag]);
    setText('');
    setOpen(false);
  };
  const suggestions = known.filter(
    (t) => !member.tags.includes(t) && t.toLowerCase().includes(typed.toLowerCase()),
  );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {member.tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-0.5 rounded-full bg-muted py-0.5 pr-1 pl-2 text-xs"
        >
          #{t}
          <button
            type="button"
            aria-label={`Remove tag ${t} from ${member.name}`}
            onClick={() => onChange(member.tags.filter((x) => x !== t))}
            className="relative rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-['']"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          aria-label={`Add a tag to ${member.name}`}
          className="relative inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Plus className="size-3.5" aria-hidden />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={6} align="start" className="z-50">
            <Popover.Popup className={popup}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  add(typed);
                }}
              >
                <Input
                  autoFocus
                  value={text}
                  maxLength={30}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Add a tag, press Enter"
                  aria-label="Tag"
                  className="h-8"
                />
              </form>
              {suggestions.length > 0 && (
                <div className="mt-1 flex max-h-48 flex-col overflow-y-auto">
                  {suggestions.map((t) => (
                    <button key={t} type="button" className={option} onClick={() => add(t)}>
                      #{t}
                    </button>
                  ))}
                </div>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
