'use client';
// Project settings: display name and icon, the task manager the factory uses to read and create
// tickets, PR tending, and the PR review profile. "Fill from repository" asks an agent to explore the
// repo and propose values; nothing is saved until you save.
import { Tabs } from '@base-ui/react/tabs';
import {
  FolderSearch,
  GitPullRequest,
  ListChecks,
  LoaderCircle,
  SlidersHorizontal,
  Tickets,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition, type ReactNode } from 'react';
import { detectProjectSettings, saveProjectSettings } from '@/app/actions';
import { SettingsDialogTitle, useSettingsDialog } from '@/components/settings-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { defaultPrefix, issueKey } from '@factory/core';
import type { ProjectSettings, SettingsProposal } from '@/lib/settings';
import { cn } from '@/lib/utils';

type TaskManager = ProjectSettings['task_manager'];
const KINDS: { value: TaskManager['kind']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'jira', label: 'Jira' },
  { value: 'github', label: 'GitHub Issues' },
  { value: 'linear', label: 'Linear' },
  { value: 'other', label: 'Other' },
];

type SectionId = 'general' | 'setup' | 'tasks' | 'tending' | 'reviews';
// `group` starts a new block in the section list.
const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; group?: boolean }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'setup', label: 'Setup check', icon: ListChecks },
  { id: 'tasks', label: 'Task manager', icon: Tickets, group: true },
  { id: 'tending', label: 'PR tending', icon: Wrench, group: true },
  { id: 'reviews', label: 'PR reviews', icon: GitPullRequest },
];

const mono = 'font-mono md:text-xs';

/** One setting: label and hint on the left, the control on the right, or under them when `stacked`. */
function Row({
  label,
  hint,
  stacked,
  children,
}: {
  label: string;
  hint?: ReactNode;
  stacked?: boolean;
  children: (id: string, hintId: string | undefined) => ReactNode;
}) {
  const id = useId();
  const hintId = useId();
  const text = (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
  if (stacked)
    return (
      <div className="py-4">
        {text}
        <div className="mt-2.5">{children(id, hint ? hintId : undefined)}</div>
      </div>
    );
  return (
    <div className="grid gap-x-8 gap-y-2.5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] sm:items-center">
      {text}
      <div className="min-w-0">{children(id, hint ? hintId : undefined)}</div>
    </div>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mt-8 first:mt-0">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <div className="divide-y border-b">{children}</div>
    </div>
  );
}

function Pane({
  value,
  title,
  description,
  children,
}: {
  value: SectionId;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Tabs.Panel value={value} className="px-5 py-6 outline-none sm:px-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
      <div className="mt-5">{children}</div>
    </Tabs.Panel>
  );
}

export function ProjectSettingsForm({
  project,
  repo,
  initial,
  setupCheck,
}: {
  project: string;
  repo: string;
  initial: ProjectSettings;
  /** Server-rendered setup check. It is not part of the form, so Save does not cover it. */
  setupCheck?: ReactNode;
}) {
  const router = useRouter();
  const dialog = useSettingsDialog();
  const [section, setSection] = useState<SectionId>('general');
  const [displayName, setDisplayName] = useState(initial.display_name ?? '');
  const [icon, setIcon] = useState(initial.icon ?? '');
  const [prefix, setPrefix] = useState(initial.prefix ?? '');
  const [tm, setTm] = useState<TaskManager>(initial.task_manager);
  const [docs, setDocs] = useState((initial.task_manager.docs ?? []).join('\n'));
  const [tending, setTending] = useState(initial.tending);
  const [profile, setProfile] = useState(initial.review_profile ?? '');
  const [proposal, setProposal] = useState<SettingsProposal>();
  const [notice, setNotice] = useState<{ kind: 'error' | 'status'; text: string }>();
  const [saving, startSave] = useTransition();
  const [detecting, startDetect] = useTransition();
  const set = (patch: Partial<TaskManager>) => setTm((t) => ({ ...t, ...patch }));

  const values = {
    display_name: displayName,
    icon,
    prefix,
    task_manager: {
      ...tm,
      docs: docs
        .split('\n')
        .map((d) => d.trim())
        .filter(Boolean),
    },
    review_profile: profile,
    tending,
  };
  const snapshot = JSON.stringify(values);
  const [saved, setSaved] = useState(snapshot);
  const dirty = snapshot !== saved;
  const prefixError =
    prefix && !/^[A-Z][A-Z0-9]{1,4}$/.test(prefix)
      ? 'Use 2 to 5 capital letters or digits, starting with a letter.'
      : undefined;
  useEffect(() => dialog?.setDirty(dirty), [dialog, dirty]);

  const detect = () => {
    setNotice(undefined);
    startDetect(async () => {
      const result = await detectProjectSettings(project);
      if (result.error || !result.proposal) {
        setNotice({ kind: 'error', text: result.error ?? 'No proposal.' });
        return;
      }
      const p = result.proposal;
      setProposal(p);
      if (!displayName.trim()) setDisplayName(p.display_name);
      if (!icon.trim()) setIcon(p.icon);
      setTm({ ...p.task_manager });
      setDocs((p.task_manager.docs ?? []).join('\n'));
      setNotice({ kind: 'status', text: 'Filled from the repository. Check the fields, then save.' });
    });
  };

  const save = () => {
    setNotice(undefined);
    const submitted = snapshot;
    startSave(async () => {
      const result = await saveProjectSettings(project, values);
      setNotice(result.error ? { kind: 'error', text: result.error } : { kind: 'status', text: 'Saved.' });
      if (!result.error) {
        setSaved(submitted);
        router.refresh();
      }
    });
  };

  const textField = (key: keyof TaskManager, id: string, hint: string | undefined) => (
    <Input
      id={id}
      aria-describedby={hint}
      spellCheck={false}
      className={mono}
      value={(tm[key] as string | undefined) ?? ''}
      onChange={(e) => set({ [key]: e.target.value })}
    />
  );

  const commandRows: { key: keyof TaskManager; label: string; hint: string }[] = [
    { key: 'read_ticket', label: 'Read a ticket', hint: 'Use {key} for the ticket key.' },
    { key: 'list_tickets', label: 'List tickets', hint: "Lists the project's open tickets." },
    { key: 'search', label: 'Search tickets', hint: 'Use {query} for the search text.' },
    { key: 'create_ticket', label: 'Create a ticket', hint: 'Use {summary} and {description}.' },
    { key: 'create_epic', label: 'Create an epic', hint: 'Use {summary} and {description}.' },
  ];

  const Title = dialog ? SettingsDialogTitle : 'h1';

  return (
    <Tabs.Root
      orientation="vertical"
      value={section}
      onValueChange={(value) => setSection(value as SectionId)}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <Title className="text-base font-semibold">Project settings</Title>
          <p className="flex min-w-0 gap-1.5 font-mono text-xs text-muted-foreground">
            <span className="shrink-0">{project}</span>
            <span aria-hidden>·</span>
            <span className="truncate" title={repo}>
              {repo}
            </span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={detect} disabled={detecting || saving}>
          {detecting ? (
            <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
          ) : (
            <FolderSearch aria-hidden />
          )}
          <span className="max-sm:sr-only">
            {detecting ? 'Exploring the repository…' : 'Fill from repository'}
          </span>
        </Button>
        {dialog && (
          <Button variant="ghost" size="icon" aria-label="Close settings" onClick={dialog.close}>
            <X aria-hidden />
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <Tabs.List
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-52 sm:flex-col sm:overflow-x-visible sm:border-r sm:border-b-0 sm:p-3"
        >
          {SECTIONS.map(({ id, label, icon: Icon, group }) => (
            <Tabs.Tab
              key={id}
              value={id}
              className={cn(
                'flex h-11 shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted data-active:bg-muted data-active:font-medium data-active:text-foreground sm:h-9 sm:px-2.5',
                group && 'sm:mt-4',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {proposal && (
            <div
              role="status"
              className="mx-5 mt-5 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm sm:mx-8"
            >
              <p>{proposal.summary}</p>
              {proposal.evidence.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  From: <span className="font-mono">{proposal.evidence.join(', ')}</span>
                </p>
              )}
            </div>
          )}

          <Pane
            value="general"
            title="General"
            description="How this project appears in the app. The project id stays fixed."
          >
            <Group>
              <Row label="Display name" hint={`Shown in the sidebar and page titles. Empty uses ${project}.`}>
                {(id, hint) => (
                  <Input
                    id={id}
                    aria-describedby={hint}
                    value={displayName}
                    placeholder={project}
                    maxLength={80}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                )}
              </Row>
              <Row
                label="Task prefix"
                hint={
                  prefixError ??
                  `Task keys read ${issueKey(prefix || defaultPrefix(project), 12)}. Empty uses ${defaultPrefix(project)}.`
                }
              >
                {(id, hint) => (
                  <Input
                    id={id}
                    value={prefix}
                    maxLength={5}
                    spellCheck={false}
                    autoCapitalize="characters"
                    aria-describedby={hint}
                    aria-invalid={!!prefixError}
                    placeholder={defaultPrefix(project)}
                    onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                    className="w-24 font-mono sm:ml-auto md:text-xs"
                  />
                )}
              </Row>
              <Row label="Icon" hint="An emoji or two letters.">
                {(id, hint) => (
                  <Input
                    id={id}
                    value={icon}
                    maxLength={8}
                    aria-describedby={hint}
                    placeholder={project[0]?.toUpperCase()}
                    onChange={(e) => setIcon(e.target.value)}
                    className="w-24 sm:ml-auto"
                  />
                )}
              </Row>
            </Group>
          </Pane>

          <Pane
            value="setup"
            title="Setup check"
            description="Runs the preflight checks, then setup, test and full check on the base branch in a temporary worktree. No model is called, so it costs nothing."
          >
            {setupCheck}
          </Pane>

          <Pane
            value="tasks"
            title="Task manager"
            description="Where this team tracks work. Agents use these commands to read tasks and create tickets and epics, and the PR review agent uses them to fetch a PR's ticket."
          >
            <Group title="Connection">
              <Row label="Kind">
                {(id) => (
                  <select
                    id={id}
                    value={tm.kind}
                    onChange={(e) => set({ kind: e.target.value as TaskManager['kind'] })}
                    className="h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                  >
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                )}
              </Row>
              {tm.kind !== 'none' && (
                <>
                  <Row label="CLI" hint="For example acli or gh.">
                    {(id, hint) => textField('cli', id, hint)}
                  </Row>
                  <Row label="Project key or board">{(id, hint) => textField('project_key', id, hint)}</Row>
                </>
              )}
            </Group>
            {tm.kind === 'none' ? (
              <p className="mt-6 text-sm text-muted-foreground">
                Choose a kind to set the commands agents use for tickets.
              </p>
            ) : (
              <>
                <Group title="Commands">
                  {commandRows.map((f) => (
                    <Row key={f.key} label={f.label} hint={f.hint} stacked>
                      {(id, hint) => textField(f.key, id, hint)}
                    </Row>
                  ))}
                </Group>
                <Group title="Context for agents">
                  <Row
                    label="Usage docs in the repository"
                    hint="One path per line, for example AGENTS.md or .claude/skills/jira/SKILL.md."
                    stacked
                  >
                    {(id, hint) => (
                      <Textarea
                        id={id}
                        aria-describedby={hint}
                        rows={3}
                        spellCheck={false}
                        className={mono}
                        value={docs}
                        onChange={(e) => setDocs(e.target.value)}
                      />
                    )}
                  </Row>
                  <Row
                    label="Notes"
                    hint="Conventions: key format, required fields, epic linking, PR title rules."
                    stacked
                  >
                    {(id, hint) => (
                      <Textarea
                        id={id}
                        aria-describedby={hint}
                        rows={4}
                        value={tm.notes ?? ''}
                        onChange={(e) => set({ notes: e.target.value })}
                      />
                    )}
                  </Row>
                </Group>
              </>
            )}
          </Pane>

          <Pane
            value="tending"
            title="PR tending"
            description="Keep open factory pull requests moving by addressing failed checks and conflicts."
          >
            <Group>
              <Row
                label="Enable PR tending"
                hint="Fix failed checks and merge conflicts on open factory PRs."
              >
                {(id, hint) => (
                  <input
                    id={id}
                    type="checkbox"
                    aria-describedby={hint}
                    className="size-4 cursor-pointer accent-primary sm:ml-auto sm:block"
                    checked={tending.enabled}
                    onChange={(e) => setTending((t) => ({ ...t, enabled: e.target.checked }))}
                  />
                )}
              </Row>
              <Row label="Answer review threads" hint="Reply to review comments on those PRs.">
                {(id, hint) => (
                  <input
                    id={id}
                    type="checkbox"
                    aria-describedby={hint}
                    className="size-4 cursor-pointer accent-primary sm:ml-auto sm:block"
                    checked={tending.answer_threads}
                    onChange={(e) => setTending((t) => ({ ...t, answer_threads: e.target.checked }))}
                  />
                )}
              </Row>
            </Group>
          </Pane>

          <Pane
            value="reviews"
            title="PR reviews"
            description="The senior-pr-review profile for this repository: ticket system, test and coverage commands, high-risk paths, standards sources, and known-dismissed findings."
          >
            <Group>
              <Row
                label="Review profile (Markdown)"
                hint="Leave empty to use the bundled profile for this repository name, if there is one (definitions/skills/senior-pr-review/profiles)."
                stacked
              >
                {(id, hint) => (
                  <Textarea
                    id={id}
                    aria-describedby={hint}
                    rows={14}
                    spellCheck={false}
                    className={mono}
                    value={profile}
                    onChange={(e) => setProfile(e.target.value)}
                  />
                )}
              </Row>
            </Group>
          </Pane>
        </div>
      </div>

      <footer className="flex items-center gap-3 border-t px-4 py-3 sm:px-5">
        {notice ? (
          <p
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'min-w-0 flex-1 text-sm',
              notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {notice.text}
          </p>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">{dirty ? 'Unsaved changes.' : ''}</p>
        )}
        <Button onClick={save} disabled={saving || detecting || !dirty || !!prefixError}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </footer>
    </Tabs.Root>
  );
}
