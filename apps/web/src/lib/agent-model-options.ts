import {
  ModelRef,
  USER_PROVIDERS,
  type UserProvider,
  type ProviderSettings,
  type UserEnvironment,
} from '@factory/core';
import { AGENT_MODELS } from '@/lib/agent-models';
import { userEnvironment, userSettings } from '@/lib/user-settings';

export type AgentModelOptions = Record<UserProvider, { id: string; name: string }[]>;

export async function agentModelOptions(): Promise<AgentModelOptions> {
  const [environment, settings] = await Promise.all([userEnvironment(), userSettings()]);
  const found = environment.ok ? environment.value.providers : undefined;
  const configured = settings.ok ? settings.value.providers : undefined;
  const options: AgentModelOptions = {
    claude: AGENT_MODELS.map((model) => ({ id: model.id, name: model.name })),
    codex: [],
    pi: [],
  };
  for (const provider of USER_PROVIDERS) {
    options[provider] = providerModels(
      provider,
      options[provider],
      found?.[provider],
      configured?.[provider],
    );
  }
  if (!configured?.codex.disabled_models.length) options.codex.push({ id: 'codex', name: 'CLI default' });
  return options;
}

function providerModels(
  provider: UserProvider,
  catalog: AgentModelOptions[UserProvider],
  found: UserEnvironment['providers'][UserProvider] | undefined,
  preferences: ProviderSettings | undefined,
): AgentModelOptions[UserProvider] {
  const models = new Map<string, { id: string; name: string }>();
  const add = (id: string, name = id) => {
    if (preferences?.disabled_models.includes(id) || models.has(id)) return;
    const ref = provider === 'claude' ? id : `${provider}:${id}`;
    if (ModelRef.safeParse(ref).success) models.set(id, { id: ref, name });
  };
  if (preferences?.default_model) add(preferences.default_model);
  for (const model of catalog) add(model.id, model.name);
  for (const model of found?.models ?? []) add(model.id, provider === 'pi' ? model.id : model.name);
  for (const id of preferences?.custom_models ?? []) add(id);
  return [...models.values()];
}
