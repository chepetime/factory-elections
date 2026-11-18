'use client';
// Project settings: display name and icon, the task manager the factory uses to read and create
// tickets, and the PR review profile. "Fill from repository" asks an agent to explore the repo and
// propose values; nothing is saved until you save.
import { LoaderCircle, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { detectProjectSettings, saveProjectSettings } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-xs">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-0.5 mb-4 text-sm text-muted-foreground">{description}</p>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function ProjectSettingsForm({
  project,
  repo,
  initial,
}: {
  project: string;
  repo: string;
  initial: ProjectSettings;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.display_name ?? '');
  const [icon, setIcon] = useState(initial.icon ?? '');
  const [tm, setTm] = useState<TaskManager>(initial.task_manager);
  const [docs, setDocs] = useState((initial.task_manager.docs ?? []).join('\n'));
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
      });
      setNotice(result.error ? { kind: 'error', text: result.error } : { kind: 'status', text: 'Saved.' });
      if (!result.error) router.refresh();
    });
  };

  const tmFields: { key: keyof TaskManager; label: string; hint?: string; mono?: boolean }[] = [
    { key: 'cli', label: 'CLI', hint: 'The command-line tool, e.g. acli or gh.', mono: true },
    { key: 'project_key', label: 'Project key or board', mono: true },
    { key: 'read_ticket', label: 'Read a ticket', hint: 'Use {key} for the ticket key.', mono: true },
    { key: 'search', label: 'Search tickets', hint: 'Use {query} for the search text.', mono: true },
    { key: 'create_ticket', label: 'Create a ticket', hint: 'Use {summary} and {description}.', mono: true },
    { key: 'create_epic', label: 'Create an epic', hint: 'Use {summary} and {description}.', mono: true },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Project settings</h1>
          <p className="mt-1 text-muted-foreground">
            <span className="font-mono text-sm">{project}</span> ·{' '}
            <span className="font-mono text-sm">{repo}</span>
          </p>
        </div>
        <Button variant="outline" onClick={detect} disabled={detecting || saving}>
          {detecting ? (
            <LoaderCircle className="size-4 motion-safe:animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {detecting ? 'Exploring the repository…' : 'Fill from repository'}
        </Button>
      </div>

      {proposal && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <p>{proposal.summary}</p>
          {proposal.evidence.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              From: <span className="font-mono">{proposal.evidence.join(', ')}</span>
            </p>
          )}
        </div>
      )}

      <Section title="General" description="How this project appears in the app. The project id stays fixed.">
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
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
          <Field label="Icon" hint="An emoji or two letters.">
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
      </Section>

      <Section
        title="Task manager"
        description="Where this team tracks work. Agents use these commands to read tasks and create tickets and epics, and the PR review agent uses them to fetch a PR's ticket."
      >
        <Field label="Kind">
          {(id) => (
            <select
              id={id}
              value={tm.kind}
              onChange={(e) => set({ kind: e.target.value as TaskManager['kind'] })}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
            {tmFields.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                {(id, hint) => (
                  <Input
                    id={id}
                    aria-describedby={hint}
                    spellCheck={false}
                    className={f.mono ? 'font-mono' : undefined}
                    value={(tm[f.key] as string | undefined) ?? ''}
                    onChange={(e) => set({ [f.key]: e.target.value })}
                  />
                )}
              </Field>
            ))}
            <Field
              label="Usage docs in the repository"
              hint="One path per line, e.g. AGENTS.md or .claude/skills/jira/SKILL.md."
            >
              {(id, hint) => (
                <Textarea
                  id={id}
                  aria-describedby={hint}
                  rows={3}
                  className="font-mono"
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
      </Section>

      <Section
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
              className="font-mono text-xs"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            />
          )}
        </Field>
      </Section>

      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 bg-background/95 px-1 py-3 backdrop-blur">
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
