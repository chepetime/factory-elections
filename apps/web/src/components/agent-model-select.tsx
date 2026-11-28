'use client';

import { PROVIDER_NAMES, USER_PROVIDERS, UserProvider } from '@factory/core';
import { NativeSelect, NativeSelectOption } from '@factory/ui/components/native-select';
import type { AgentModelOptions } from '@/lib/agent-model-options';

export function AgentProviderSelect({
  id,
  provider,
  onChange,
}: {
  id: string;
  provider: UserProvider;
  onChange: (provider: UserProvider) => void;
}) {
  return (
    <NativeSelect
      id={id}
      value={provider}
      onChange={(event) => onChange(UserProvider.parse(event.target.value))}
      className="w-full"
    >
      {USER_PROVIDERS.map((provider) => (
        <NativeSelectOption key={provider} value={provider}>
          {PROVIDER_NAMES[provider]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export function AgentModelSelect({
  id,
  model,
  options,
  onChange,
}: {
  id: string;
  model: string;
  options: AgentModelOptions[UserProvider];
  onChange: (model: string) => void;
}) {
  return (
    <NativeSelect
      id={id}
      name="model"
      value={model}
      onChange={(event) => onChange(event.target.value)}
      required
      className="w-full"
    >
      {!model && (
        <NativeSelectOption value="" disabled>
          No models available
        </NativeSelectOption>
      )}
      {options.map(({ id, name }) => (
        <NativeSelectOption key={id} value={id}>
          {name}
        </NativeSelectOption>
      ))}
      {model && !options.some((option) => option.id === model) && (
        <NativeSelectOption value={model}>{model}</NativeSelectOption>
      )}
    </NativeSelect>
  );
}
