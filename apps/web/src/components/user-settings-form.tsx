'use client';
// User settings: identity, the agent providers and models the factory may use, and global rules.
// The backend refuses a run on a provider or model turned off here, and adds the rules to every
// agent's system prompt.
import { LoaderCircle, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, useTransition, type ReactNode } from 'react';
import { saveUserSettings } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PROVIDER_NAMES, USER_PROVIDERS, type UserProvider } from '@factory/core';
import type { UserEnvironment, UserSettings } from '@/lib/user-settings';
import { cn } from '@/lib/utils';

type Model = UserEnvironment['providers']['claude']['models'][number];

const PROVIDER_HINTS: Record<UserProvider, string> = {
  claude: 'Runs tasks, reviews, agents and chats. Models come from the factory catalog.',
  codex:
    'Runs coding steps. Codex cannot list its models: the configured one shows here, and you can add more by id.',
  pi: 'Models come from pi --list-models. The factory cannot run Pi yet, so these settings take effect when it can.',
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string, hintId: string | undefined) => ReactNode;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="grid gap-x-8 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        {hint && (
          <p id={hintId} className="mt-1 text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <div className="min-w-0">{children(id, hint ? hintId : undefined)}</div>
    </div>
  );
}

/** Every model to show for a provider: what the CLI offers, what you added, and what you turned off. */
function modelsFor(found: readonly Model[], p: UserSettings['providers']['claude']): Model[] {
  const seen = new Map<string, Model>();
  for (const m of found) seen.set(m.id, m);
  for (const id of [...p.custom_models, ...p.disabled_models]) if (!seen.has(id)) seen.set(id, { id });
  return [...seen.values()];
}

function ProviderCard({
  provider,
  env,
  settings,
  onChange,
}: {
  provider: UserProvider;
  env: UserEnvironment['providers']['claude'] | undefined;
  settings: UserSettings;
  onChange: (next: UserSettings['providers']['claude']) => void;
}) {
  const p = settings.providers[provider];
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState('');
  const toggleId = useId();
  const defaultId = useId();
  const models = useMemo(() => modelsFor(env?.models ?? [], p), [env, p]);
  const shown = filter
    ? models.filter((m) => `${m.id} ${m.name ?? ''}`.toLowerCase().includes(filter.toLowerCase()))
    : models;
  const enabledModels = models.filter((m) => !p.disabled_models.includes(m.id));
  const setModel = (id: string, on: boolean) =>
    onChange({
      ...p,
      disabled_models: on ? p.disabled_models.filter((m) => m !== id) : [...p.disabled_models, id],
      ...(!on && p.default_model === id ? { default_model: undefined } : {}),
    });
  const add = () => {
    const id = adding.trim();
    if (!id || models.some((m) => m.id === id)) return setAdding('');
    onChange({ ...p, custom_models: [...p.custom_models, id] });
    setAdding('');
  };
  const groups = Map.groupBy(shown, (m) => m.group ?? '');

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <label htmlFor={toggleId} className="font-medium">
            {PROVIDER_NAMES[provider]}
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {!env ? (
              'Not checked'
            ) : env.installed ? (
              <>
                Installed{env.version ? ` · ${env.version}` : ''} · {enabledModels.length} of {models.length}{' '}
                models on
              </>
            ) : (
              <span className="text-destructive">Not installed on this machine</span>
            )}
          </p>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">{PROVIDER_HINTS[provider]}</p>
        </div>
        <input
          id={toggleId}
          type="checkbox"
          role="switch"
          aria-checked={p.enabled}
          className="mt-1 size-4 cursor-pointer accent-primary"
          checked={p.enabled}
          onChange={(e) => onChange({ ...p, enabled: e.target.checked })}
        />
      </div>

      {p.enabled && (
        <div className="border-t px-4 py-3">
          {env?.error && <p className="mb-2 text-xs text-destructive">Could not list models: {env.error}</p>}
          {models.length > 8 && (
            <Input
              type="search"
              aria-label={`Filter ${PROVIDER_NAMES[provider]} models`}
              placeholder="Filter models"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="mb-2 h-8"
            />
          )}
          {models.length === 0 ? (
            <p className="text-sm text-muted-foreground">No models found.</p>
          ) : (
            <div className={cn('flex flex-col', models.length > 8 && 'max-h-72 overflow-y-auto')}>
              {[...groups].map(([group, items]) => (
                <fieldset key={group} className="py-1">
                  {group && (
                    <legend className="px-1 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                      {group}
                    </legend>
                  )}
                  {items.map((m) => (
                    <label
                      key={m.id}
                      className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm hover:bg-accent/50 pointer-coarse:min-h-11"
                    >
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        checked={!p.disabled_models.includes(m.id)}
                        onChange={(e) => setModel(m.id, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1 truncate">{m.name ?? m.id}</span>
                      {m.name && m.name !== m.id && !m.group && (
                        <span className="truncate font-mono text-xs text-muted-foreground">{m.id}</span>
                      )}
                      {p.custom_models.includes(m.id) && (
                        <button
                          type="button"
                          aria-label={`Remove ${m.id}`}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                          onClick={(e) => {
                            e.preventDefault();
                            onChange({
                              ...p,
                              custom_models: p.custom_models.filter((x) => x !== m.id),
                              disabled_models: p.disabled_models.filter((x) => x !== m.id),
                            });
                          }}
                        >
                          <X aria-hidden="true" className="size-3.5" />
                        </button>
                      )}
                    </label>
                  ))}
                </fieldset>
              ))}
              {shown.length === 0 && <p className="py-2 text-sm text-muted-foreground">No model matches.</p>}
            </div>
          )}

          {provider === 'codex' && (
            <div className="mt-2 flex gap-2">
              <Input
                aria-label="Codex model id to add"
                placeholder="Model id, e.g. gpt-6-sol"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add();
                  }
                }}
                className="h-8 font-mono md:text-xs"
              />
              <Button type="button" variant="outline" size="sm" onClick={add} disabled={!adding.trim()}>
                <Plus aria-hidden="true" /> Add
              </Button>
            </div>
          )}

          {enabledModels.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
              <label htmlFor={defaultId} className="text-sm">
                Default model
              </label>
              <select
                id={defaultId}
                className="h-8 min-w-0 flex-1 cursor-pointer rounded-md border bg-background px-2 text-sm sm:max-w-72"
                value={p.default_model ?? ''}
                onChange={(e) => onChange({ ...p, default_model: e.target.value || undefined })}
              >
                <option value="">The CLI&apos;s own default</option>
                {enabledModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.group ? `${m.group} / ${m.name ?? m.id}` : (m.name ?? m.id)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function UserSettingsForm({
  initial,
  environment,
  environmentError,
}: {
  initial: UserSettings;
  environment: UserEnvironment | undefined;
  environmentError: string | undefined;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [saving, startSaving] = useTransition();
  const comparable = (s: UserSettings) => JSON.stringify({ ...s, updated_at: undefined });
  const dirty = comparable(settings) !== comparable(saved);
  const identity = settings.identity;
  const setIdentity = (patch: Partial<UserSettings['identity']>) =>
    setSettings((s) => ({ ...s, identity: { ...s.identity, ...patch } }));
  const login = environment?.github.login;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setStatus({});
        startSaving(async () => {
          const result = await saveUserSettings(settings);
          setStatus(result);
          if (result.error) return;
          setSaved(settings);
          router.refresh();
        });
      }}
    >
      {environmentError && (
        <p className="mt-4 text-sm text-destructive">Could not check this machine: {environmentError}</p>
      )}

      <Section title="Profile" description="How the factory names you in commits, PRs and team views.">
        <div className="divide-y border-y">
          <Field label="Name" hint={environment?.git.name ? `Git uses ${environment.git.name}` : undefined}>
            {(id, hint) => (
              <Input
                id={id}
                aria-describedby={hint}
                value={identity.name ?? ''}
                placeholder={environment?.git.name}
                onChange={(e) => setIdentity({ name: e.target.value })}
              />
            )}
          </Field>
          <Field
            label="Email"
            hint={environment?.git.email ? `Git uses ${environment.git.email}` : undefined}
          >
            {(id, hint) => (
              <Input
                id={id}
                type="email"
                aria-describedby={hint}
                value={identity.email ?? ''}
                placeholder={environment?.git.email}
                onChange={(e) => setIdentity({ email: e.target.value })}
              />
            )}
          </Field>
          <Field
            label="GitHub username"
            hint={
              login ? (
                <>
                  gh is signed in as {login}
                  {identity.github_username !== login && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="cursor-pointer underline underline-offset-2 hover:text-foreground"
                        onClick={() => setIdentity({ github_username: login })}
                      >
                        Use {login}
                      </button>
                    </>
                  )}
                </>
              ) : environment?.github.error ? (
                `gh: ${environment.github.error}`
              ) : undefined
            }
          >
            {(id, hint) => (
              <Input
                id={id}
                aria-describedby={hint}
                value={identity.github_username ?? ''}
                placeholder={login ?? 'octocat'}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => setIdentity({ github_username: e.target.value.replace(/^@/, '') })}
                className="font-mono md:text-xs"
              />
            )}
          </Field>
        </div>
      </Section>

      <Section
        title="Agent providers"
        description="Turn off a provider or a model and the factory refuses runs that ask for it, in every project."
      >
        <div className="flex flex-col gap-3">
          {USER_PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider}
              provider={provider}
              env={environment?.providers[provider]}
              settings={settings}
              onChange={(next) =>
                setSettings((s) => ({ ...s, providers: { ...s.providers, [provider]: next } }))
              }
            />
          ))}
        </div>
      </Section>

      <Section
        title="Global rules"
        description="Markdown added to every agent's system prompt, in every project, after the project's own instructions."
      >
        <Textarea
          aria-label="Global rules"
          rows={8}
          value={settings.rules}
          placeholder={'- Write commit messages in the present tense.\n- Never push to main.'}
          onChange={(e) => setSettings((s) => ({ ...s, rules: e.target.value }))}
          className="font-mono md:text-xs"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
          {settings.rules.length.toLocaleString()} / 20,000
        </p>
      </Section>

      <div className="sticky bottom-0 mt-8 flex items-center justify-end gap-3 border-t bg-background py-3">
        <p
          role="status"
          className={cn('text-sm', status.error ? 'text-destructive' : 'text-muted-foreground')}
        >
          {status.error ?? (dirty ? 'Unsaved changes' : status.message)}
        </p>
        <Button type="submit" disabled={saving || !dirty}>
          {saving && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
          Save
        </Button>
      </div>
    </form>
  );
}
