'use client';
// Project settings: display name and icon, the task manager the factory uses to read and create
// tickets, and the PR review profile. "Fill from repository" asks an agent to explore the repo and
// propose values; nothing is saved until you save.
import { FolderSearch, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type ReactNode } from 'react';
import { detectProjectSettings, saveProjectSettings } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsSection } from '@/components/settings-section';
import { Textarea } from '@/components/ui/textarea';
import type { ProjectSettings, SettingsProposal } from '@/lib/settings';

type TaskManager = ProjectSettings['task_manager'];
const KINDS: { value: TaskManager['kind']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'jira', label: 'Jira' },
  { value: 'github', label: 'GitHub Issues' },
  { value: 'linear', label: 'Linear' },
  { value: 'other', label: 'Other' },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string, hintId: string | undefined) => React.ReactNode;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id, hint ? hintId : undefined)}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
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
  /** Rendered under the header. It is not part of the form, so Save does not cover it. */
  setupCheck?: ReactNode;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.display_name ?? '');
  const [icon, setIcon] = useState(initial.icon ?? '');
  const [tm, setTm] = useState<TaskManager>(initial.task_manager);
  const [docs, setDocs] = useState((initial.task_manager.docs ?? []).join('\n'));
  const [tending, setTending] = useState(initial.tending);
  const [profile, setProfile] = useState(initial.review_profile ?? '');
  const [proposal, setProposal] = useState<SettingsProposal>();
  const [notice, setNotice] = useState<{ kind: 'error' | 'status'; text: string }>();
  const [saving, startSave] = useTransition();
  const [detecting, startDetect] = useTransition();
  const set = (patch: Partial<TaskManager>) => setTm((t) => ({ ...t, ...patch }));

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
    startSave(async () => {
      const result = await saveProjectSettings(project, {
        display_name: displayName,
        icon,
        task_manager: {
          ...tm,
          docs: docs
            .split('\n')
            .map((d) => d.trim())
            .filter(Boolean),
        },
        review_profile: profile,
        tending,
      });
      setNotice(result.error ? { kind: 'error', text: result.error } : { kind: 'status', text: 'Saved.' });
      if (!result.error) router.refresh();
    });
  };

  const commandFields: { key: keyof TaskManager; label: string; hint?: string }[] = [
    { key: 'read_ticket', label: 'Read a ticket', hint: 'Use {key} for the ticket key.' },
    { key: 'list_tickets', label: 'List tickets', hint: "Lists the project's open tickets." },
    { key: 'search', label: 'Search tickets', hint: 'Use {query} for the search text.' },
    { key: 'create_ticket', label: 'Create a ticket', hint: 'Use {summary} and {description}.' },
    { key: 'create_epic', label: 'Create an epic', hint: 'Use {summary} and {description}.' },
  ];

  const textField = (key: keyof TaskManager, id: string, hint: string | undefined) => (
    <Input
      id={id}
      aria-describedby={hint}
      spellCheck={false}
      className="font-mono md:text-xs"
      value={(tm[key] as string | undefined) ?? ''}
      onChange={(e) => set({ [key]: e.target.value })}
    />
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-2xl font-semibold tracking-tight">Project settings</h1>
          <p className="mt-1 flex min-w-0 gap-1.5 font-mono text-xs text-muted-foreground">
            <span className="shrink-0">{project}</span>
            <span aria-hidden>·</span>
            <span className="truncate" title={repo}>
              {repo}
            </span>
          </p>
        </div>
        <Button variant="outline" onClick={detect} disabled={detecting || saving}>
          {detecting ? (
            <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
          ) : (
            <FolderSearch className="size-4" aria-hidden />
          )}
          {detecting ? 'Exploring the repository…' : 'Fill from repository'}
        </Button>
      </header>

      {proposal && (
        <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <p>{proposal.summary}</p>
          {proposal.evidence.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              From: <span className="font-mono">{proposal.evidence.join(', ')}</span>
            </p>
          )}
        </div>
      )}

      {setupCheck}

      <SettingsSection
        id="settings-general"
        title="General"
        description="How this project appears in the app. The project id stays fixed."
      >
        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <Field label="Display name">
            {(id) => (
              <Input
                id={id}
                value={displayName}
                placeholder={project}
                maxLength={80}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Icon" hint="Emoji or two letters.">
            {(id, hint) => (
              <Input
                id={id}
                value={icon}
                maxLength={8}
                aria-describedby={hint}
                placeholder={project[0]?.toUpperCase()}
                onChange={(e) => setIcon(e.target.value)}
              />
            )}
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection
        id="settings-task-manager"
        title="Task manager"
        description="Where this team tracks work. Agents use these commands to read tasks and create tickets and epics, and the PR review agent uses them to fetch a PR's ticket."
      >
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <Field label="Kind">
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
          </Field>
          {tm.kind !== 'none' && (
            <>
              <Field label="CLI" hint="For example acli or gh.">
                {(id, hint) => textField('cli', id, hint)}
              </Field>
              <Field label="Project key or board">{(id, hint) => textField('project_key', id, hint)}</Field>
            </>
          )}
        </div>
        {tm.kind !== 'none' && (
          <>
            <h3 className="mt-1 border-t pt-5 text-sm font-semibold">Commands</h3>
            {commandFields.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                {(id, hint) => textField(f.key, id, hint)}
              </Field>
            ))}
            <h3 className="mt-1 border-t pt-5 text-sm font-semibold">Context for agents</h3>
            <Field
              label="Usage docs in the repository"
              hint="One path per line, for example AGENTS.md or .claude/skills/jira/SKILL.md."
            >
              {(id, hint) => (
                <Textarea
                  id={id}
                  aria-describedby={hint}
                  rows={3}
                  spellCheck={false}
                  className="font-mono md:text-xs"
                  value={docs}
                  onChange={(e) => setDocs(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Notes"
              hint="Conventions: key format, required fields, epic linking, PR title rules."
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
            </Field>
          </>
        )}
      </SettingsSection>

      <SettingsSection
        id="settings-tending"
        title="PR tending"
        description="Keep open factory pull requests moving by addressing failed checks and conflicts."
      >
        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4 cursor-pointer accent-primary"
            checked={tending.enabled}
            onChange={(e) => setTending((t) => ({ ...t, enabled: e.target.checked }))}
          />
          Enable PR tending
        </label>
        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4 cursor-pointer accent-primary"
            checked={tending.answer_threads}
            onChange={(e) => setTending((t) => ({ ...t, answer_threads: e.target.checked }))}
          />
          Answer review threads
        </label>
      </SettingsSection>

      <SettingsSection
        id="settings-reviews"
        title="PR reviews"
        description="The senior-pr-review profile for this repository: ticket system, test and coverage commands, high-risk paths, standards sources, and known-dismissed findings."
      >
        <Field
          label="Review profile (Markdown)"
          hint="Leave empty to use the bundled profile for this repository name, if there is one (definitions/skills/senior-pr-review/profiles)."
        >
          {(id, hint) => (
            <Textarea
              id={id}
              aria-describedby={hint}
              rows={10}
              spellCheck={false}
              className="font-mono md:text-xs"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            />
          )}
        </Field>
      </SettingsSection>

      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
        <Button onClick={save} disabled={saving || detecting}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        {notice && (
          <p
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={notice.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
          >
            {notice.text}
          </p>
        )}
      </div>
    </div>
  );
}
