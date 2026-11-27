'use client';
// The /user views except providers: profile, preferences, task and chat defaults, notifications and
// rules. Each control saves its section as soon as it changes; text saves when the field loses focus.
import { Plus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@factory/ui/components/button';
import { Input } from '@factory/ui/components/input';
import { Textarea } from '@factory/ui/components/textarea';
import { NOTIFY_KINDS } from '@factory/core';
import type { UserEnvironment, UserSettings } from '@/lib/user-settings';
import {
  selectClass,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  SwitchRow,
  useSection,
} from '@/components/user-settings/settings-ui';

export function ProfileView({
  initial,
  environment,
}: {
  initial: UserSettings['identity'];
  environment: UserEnvironment | undefined;
}) {
  const { value, edit, save, status } = useSection('identity', initial);
  const login = environment?.github.login;
  const text = (key: 'name' | 'github_username' | 'about') => ({
    value: value[key] ?? '',
    onChange: (e: { target: { value: string } }) => edit({ ...value, [key]: e.target.value }),
    onBlur: () => save(),
  });
  return (
    <SettingsPage title="Profile" status={status}>
      <SettingsGroup title="Personal information">
        <SettingRow label="Name" hint={environment?.git.name && `Git uses ${environment.git.name}`}>
          {(id, hint) => (
            <Input id={id} aria-describedby={hint} placeholder={environment?.git.name} {...text('name')} />
          )}
        </SettingRow>
        <EmailsRow
          emails={value.emails}
          suggestions={[
            ...(environment?.git.email ? [{ email: environment.git.email, from: 'global git config' }] : []),
            ...(environment?.git.project_emails ?? []).map((p) => ({ email: p.email, from: p.project })),
          ]}
          onChange={(emails) => save({ ...value, emails })}
        />
        <SettingRow
          label="GitHub username"
          hint={
            login ? (
              <>
                gh is signed in as {login}
                {value.github_username !== login && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="cursor-pointer underline underline-offset-2 hover:text-foreground"
                      onClick={() => save({ ...value, github_username: login })}
                    >
                      Use {login}
                    </button>
                  </>
                )}
              </>
            ) : (
              environment?.github.error && `gh: ${environment.github.error}`
            )
          }
        >
          {(id, hint) => (
            <Input
              id={id}
              aria-describedby={hint}
              placeholder={login ?? 'octocat'}
              autoCapitalize="none"
              spellCheck={false}
              className="font-mono md:text-xs"
              {...text('github_username')}
              onChange={(e) => edit({ ...value, github_username: e.target.value.replace(/^@/, '') })}
            />
          )}
        </SettingRow>
        <SettingRow
          label="About you"
          hint="Agents get this with every task: your role, stack and how you like to work."
          stacked
        >
          {(id, hint) => (
            <>
              <Textarea
                id={id}
                aria-describedby={hint}
                rows={3}
                maxLength={2000}
                placeholder="e.g. Frontend engineer (Next.js, Tailwind). I prefer small PRs with tests in the same change."
                {...text('about')}
              />
              <p className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
                {(value.about ?? '').length}/2000
              </p>
            </>
          )}
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  );
}

/** Emails as rows: the first is primary, any can be removed, and git's emails are one click away. */
function EmailsRow({
  emails,
  suggestions,
  onChange,
}: {
  emails: string[];
  suggestions: { email: string; from: string }[];
  onChange: (emails: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const inputId = useId();
  const errorId = useId();
  const has = (e: string) => emails.some((x) => x.toLowerCase() === e.toLowerCase());
  const offers = suggestions.filter(
    (s, i) => !has(s.email) && suggestions.findIndex((t) => t.email === s.email) === i,
  );
  const add = (email: string) => {
    const e = email.trim();
    if (!e) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setError('Use a full email address.');
    setError(undefined);
    setDraft('');
    if (!has(e)) onChange([...emails, e]);
  };
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <div>
        <label htmlFor={inputId} className="text-sm font-medium">
          Emails
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Every email you commit with, such as personal and work. The first is your primary email.
        </p>
      </div>
      {emails.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {emails.map((email, i) => (
            <li key={email} className="flex min-h-10 items-center gap-2 px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{email}</span>
              {i === 0 ? (
                <span className="text-xs text-muted-foreground">Primary</span>
              ) : (
                <button
                  type="button"
                  className="cursor-pointer rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => onChange([email, ...emails.filter((x) => x !== email)])}
                >
                  Make primary
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                className="cursor-pointer rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:p-3"
                onClick={() => onChange(emails.filter((x) => x !== email))}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
        }}
      >
        <Input
          id={inputId}
          type="email"
          placeholder="name@example.com"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!draft.trim()}>
          <Plus aria-hidden="true" /> Add
        </Button>
      </form>
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
      {offers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Found in git:
          {offers.map((o) => (
            <button
              key={o.email}
              type="button"
              className="cursor-pointer rounded-md border bg-background px-2 py-1 text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => add(o.email)}
            >
              <Plus aria-hidden="true" className="mr-1 inline size-3" />
              {o.email} <span className="text-muted-foreground">({o.from})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const never = () => () => {};

export function PreferencesView({ initial }: { initial: UserSettings['preferences'] }) {
  const { value, save, status } = useSection('preferences', initial);
  // Only the browser knows its own zone and the zone list.
  const browserZone = useSyncExternalStore(
    never,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => '',
  );
  const zones = useMemo(() => (browserZone ? Intl.supportedValuesOf('timeZone') : []), [browserZone]);
  return (
    <SettingsPage title="Preferences" status={status}>
      <SettingsGroup title="General">
        <SettingRow label="Theme" hint="System follows your operating system's light or dark setting.">
          {(id, hint) => (
            <select
              id={id}
              aria-describedby={hint}
              className={selectClass}
              value={value.theme}
              onChange={(e) => save({ ...value, theme: e.target.value as typeof value.theme })}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          )}
        </SettingRow>
        <SettingRow label="Time zone" hint="Used for the times the app shows, such as inbox and run times.">
          {(id, hint) => (
            <select
              id={id}
              aria-describedby={hint}
              className={`${selectClass} font-mono md:text-xs`}
              value={value.time_zone ?? ''}
              onChange={(e) => save({ ...value, time_zone: e.target.value || undefined })}
            >
              <option value="">{browserZone ? `${browserZone} (browser)` : 'Browser zone'}</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          )}
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  );
}

const TASK_TYPES = [
  { value: 'ticket', label: 'Create ticket' },
  { value: 'work', label: 'Work on task' },
  { value: 'review', label: 'PR review' },
  { value: 'general', label: 'General' },
] as const;

export function TasksView({ initial }: { initial: UserSettings['tasks'] }) {
  const { value, save, status } = useSection('tasks', initial);
  return (
    <SettingsPage
      title="Tasks"
      description="How the new-task box starts. You can still change each choice in the box itself."
      status={status}
    >
      <SettingsGroup title="New task">
        <SettingRow label="Task type" hint="The type selected when the box opens.">
          {(id, hint) => (
            <select
              id={id}
              aria-describedby={hint}
              className={selectClass}
              value={value.default_type}
              onChange={(e) => save({ ...value, default_type: e.target.value as typeof value.default_type })}
            >
              {TASK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
        </SettingRow>
        <SwitchRow
          label="Start new tasks"
          hint="On: a new task goes to Todo, and an agent starts it. Off: it waits in Backlog."
          checked={value.start_runs}
          onChange={(start_runs) => save({ ...value, start_runs })}
        />
        <SwitchRow
          label="Jira issue key"
          hint="Show the optional Jira key field for Work on task."
          checked={value.jira_key_field}
          onChange={(jira_key_field) => save({ ...value, jira_key_field })}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}

const APPROVAL = [
  {
    value: 'request',
    label: 'Request approval',
    hint: 'Ask before editing outside files or using the internet.',
  },
  { value: 'auto', label: 'Approve for me', hint: 'Ask only for actions that may be unsafe.' },
  {
    value: 'full',
    label: 'Full access',
    hint: 'No questions: the internet and every file on this computer.',
  },
] as const;

export function ChatView({ initial }: { initial: UserSettings['chat'] }) {
  const { value, save, status } = useSection('chat', initial);
  const chosen = APPROVAL.find((a) => a.value === value.approval_mode)!;
  return (
    <SettingsPage title="Chat" status={status}>
      <SettingsGroup title="New chats">
        <SettingRow label="Approval mode" hint={chosen.hint}>
          {(id, hint) => (
            <select
              id={id}
              aria-describedby={hint}
              className={selectClass}
              value={value.approval_mode}
              onChange={(e) => save({ approval_mode: e.target.value as typeof value.approval_mode })}
            >
              {APPROVAL.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          )}
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  );
}

const KIND_TEXT: Record<(typeof NOTIFY_KINDS)[number], { label: string; hint: string }> = {
  gate: { label: 'Approvals', hint: 'A task finished its checks and waits for you to approve it.' },
  blocked: {
    label: 'Blocked tasks',
    hint: 'The classifier needs a clarification, research or a smaller task.',
  },
  failed: { label: 'Failures', hint: 'A task, feature step or ticket failed.' },
  question: { label: 'Questions', hint: 'A grilling agent asked you something.' },
  'approve-spec': { label: 'Specs to approve', hint: 'A feature spec is ready for your review.' },
  'approve-board': { label: 'Boards to approve', hint: 'A feature board is ready for your review.' },
  qa: { label: 'QA plans', hint: 'A QA plan is ready for you to run.' },
  merge: { label: 'Waiting on merges', hint: 'A ticket waits for its blockers to merge.' },
  review: { label: 'PR reviews', hint: 'A PR review finished and its findings are ready.' },
  tending: { label: 'PR tending', hint: 'Tending could not keep a PR moving on its own.' },
  'review-loop': {
    label: 'Review loop stops',
    hint: 'The review loop of an agent PR stopped and the PR may sit in draft.',
  },
  recovery: { label: 'Recovery problems', hint: 'After a restart, the backend could not read some work.' },
  finding: { label: 'Findings', hint: 'The daily retro found a waste pattern that repeats across runs.' },
  'spend-spike': {
    label: 'Spend spikes',
    hint: 'A step and model costs much more per run than its 14-day median.',
  },
};

type Permission = NotificationPermission | 'unsupported';
function usePermission(): [Permission, () => void] {
  const read = (): Permission =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const [permission, setPermission] = useState<Permission>('default');
  useEffect(() => setPermission(read()), []);
  const ask = () => void Notification.requestPermission().then(setPermission);
  return [permission, ask];
}

export function NotificationsView({ initial }: { initial: UserSettings['notifications'] }) {
  const { value, save, status } = useSection('notifications', initial);
  const [permission, ask] = usePermission();
  return (
    <SettingsPage title="Notifications" status={status}>
      <SettingsGroup
        title="Browser notifications"
        description="A banner from your browser for each new inbox item, while this app is in the background."
      >
        <SwitchRow
          label="Show banners"
          hint="The app checks the inbox every 15 seconds while a tab is open."
          checked={value.browser}
          onChange={(browser) => {
            save({ ...value, browser });
            if (browser && permission === 'default') ask();
          }}
        />
        <SettingRow
          label="Browser permission"
          hint={
            permission === 'granted'
              ? 'This browser may show banners.'
              : permission === 'denied'
                ? 'This browser blocks banners. Allow them in the site settings of your browser.'
                : permission === 'unsupported'
                  ? 'This browser cannot show banners.'
                  : 'This browser has not been asked yet.'
          }
        >
          {(id, hint) => (
            <Button
              id={id}
              type="button"
              variant="outline"
              size="sm"
              aria-describedby={hint}
              className="ml-auto flex"
              disabled={permission !== 'default'}
              onClick={ask}
            >
              {permission === 'granted' ? 'Allowed' : permission === 'denied' ? 'Blocked' : 'Allow'}
            </Button>
          )}
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Inbox items"
        description="Which kinds of item raise a banner. Every kind still shows in the inbox."
      >
        {NOTIFY_KINDS.map((kind) => (
          <SwitchRow
            key={kind}
            label={KIND_TEXT[kind].label}
            hint={KIND_TEXT[kind].hint}
            disabled={!value.browser}
            checked={!value.muted.includes(kind)}
            onChange={(on) =>
              save({ ...value, muted: on ? value.muted.filter((k) => k !== kind) : [...value.muted, kind] })
            }
          />
        ))}
      </SettingsGroup>
    </SettingsPage>
  );
}

export function RulesView({ initial }: { initial: string }) {
  const { value, edit, save, status } = useSection('rules', initial);
  return (
    <SettingsPage
      title="Rules"
      description="Markdown added to every agent's system prompt, in every project, after the project's own instructions. Saved when you leave the field."
      status={status}
    >
      <div>
        <Textarea
          aria-label="Rules for every agent"
          rows={14}
          maxLength={20_000}
          value={value}
          placeholder={'- Write commit messages in the present tense.\n- Never push to main.'}
          onChange={(e) => edit(e.target.value)}
          onBlur={() => save()}
          className="bg-card font-mono md:text-xs"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
          {value.length.toLocaleString()}/20,000
        </p>
      </div>
    </SettingsPage>
  );
}
