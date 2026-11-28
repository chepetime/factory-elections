'use client';
// Agent providers and their models. The backend refuses a run on a provider or model turned off here.
import { CircleCheck, CircleX, Plus, X } from 'lucide-react';
import { useId, useMemo, useState, useTransition } from 'react';
import { testProvider } from '@/app/actions';
import { Button } from '@factory/ui/components/button';
import { Input } from '@factory/ui/components/input';
import { LocalTime } from '@/components/local-time';
import { PROVIDER_NAMES, USER_PROVIDERS, type UserProvider } from '@factory/core';
import type { ProviderCheck, UserEnvironment, UserSettings } from '@/lib/user-settings';
import { SettingsPage, Switch, useSection } from '@/components/user-settings/settings-ui';
import { cn } from '@factory/ui/lib/utils';

type Model = UserEnvironment['providers']['claude']['models'][number];

const PROVIDER_HINTS: Record<UserProvider, string> = {
  claude: 'Runs tasks, reviews, agents and chats. Models come from the factory catalog.',
  codex:
    'Runs coding steps. Codex cannot list its models: the configured one shows here, and you can add more by id.',
  pi: 'Models come from pi --list-models. Factory can route model calls through Pi.',
};

/** Every model to show for a provider: what the CLI offers, what you added, and what you turned off. */
function modelsFor(found: readonly Model[], p: UserSettings['providers']['claude']): Model[] {
  const seen = new Map<string, Model>();
  for (const m of found) seen.set(m.id, m);
  for (const id of [...p.custom_models, ...p.disabled_models]) if (!seen.has(id)) seen.set(id, { id });
  return [...seen.values()];
}

const CHECK_LABELS: Record<ProviderCheck['name'], string> = {
  installed: 'Installed',
  signed_in: 'Signed in',
  responds: 'Responds',
};

function CheckRow({ check }: { check: ProviderCheck }) {
  const Icon = check.ok ? CircleCheck : CircleX;
  return (
    <li className="py-1 text-xs">
      <div className="flex flex-wrap items-center gap-x-2">
        <Icon
          aria-hidden="true"
          className={cn('size-4 shrink-0', check.ok ? 'text-emerald-600' : 'text-destructive')}
        />
        <span className="font-medium">{CHECK_LABELS[check.name]}</span>
        <span className="sr-only">{check.ok ? 'passed' : 'failed'}</span>
        {check.ok && check.detail && <span className="text-muted-foreground">{check.detail}</span>}
        <LocalTime iso={check.checked_at} className="ml-auto text-muted-foreground" />
      </div>
      {!check.ok && (
        <div className="mt-1 ml-6 flex flex-col gap-1">
          {check.error && (
            <pre className="max-h-32 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap text-destructive">
              {check.error}
            </pre>
          )}
          {check.fix && (
            <p className="text-muted-foreground">
              Fix: <code className="rounded bg-muted px-1 py-0.5 font-mono">{check.fix}</code>
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Installed and signed in load with the page and cost nothing; Responds runs only from the Test button. */
function ProviderChecks({ provider, checks }: { provider: UserProvider; checks: readonly ProviderCheck[] }) {
  const [tested, setTested] = useState<ProviderCheck>();
  const [testError, setTestError] = useState<string>();
  const [pending, start] = useTransition();
  const test = () =>
    start(async () => {
      const result = await testProvider(provider);
      setTestError(result.error);
      if (result.check) setTested(result.check);
    });
  const label = PROVIDER_NAMES[provider];
  return (
    <div className="border-t px-4 py-3">
      <ul aria-label={`${label} checks`} className="flex flex-col">
        {checks.map((c) => (
          <CheckRow key={c.name} check={c} />
        ))}
        {tested && <CheckRow check={tested} />}
      </ul>
      {testError && <p className="mt-1 text-xs text-destructive">Could not run the test: {testError}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={test} disabled={pending}>
          {pending ? 'Testing…' : tested ? 'Test again' : 'Test'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Sends one one-word prompt to the cheapest model. Costs a fraction of a cent.
        </span>
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  env,
  settings,
  onChange,
}: {
  provider: UserProvider;
  env: UserEnvironment['providers']['claude'] | undefined;
  settings: UserSettings['providers'];
  onChange: (next: UserSettings['providers']['claude']) => void;
}) {
  const p = settings[provider];
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
        <Switch id={toggleId} checked={p.enabled} onChange={(enabled) => onChange({ ...p, enabled })} />
      </div>

      {env && <ProviderChecks provider={provider} checks={env.checks} />}

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

export function ProvidersView({
  initial,
  environment,
  environmentError,
}: {
  initial: UserSettings['providers'];
  environment: UserEnvironment | undefined;
  environmentError: string | undefined;
}) {
  const { value, save, status } = useSection('providers', initial);
  return (
    <SettingsPage
      title="Providers and models"
      description="Turn off a provider or a model and the factory refuses runs that ask for it, in every project."
      status={status}
    >
      {environmentError && (
        <p className="text-sm text-destructive">Could not check this machine: {environmentError}</p>
      )}
      <div className="flex flex-col gap-3">
        {USER_PROVIDERS.map((provider) => (
          <ProviderCard
            key={provider}
            provider={provider}
            env={environment?.providers[provider]}
            settings={value}
            onChange={(next) => save({ ...value, [provider]: next })}
          />
        ))}
      </div>
    </SettingsPage>
  );
}
