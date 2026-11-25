// The model choices an agent offers. Agent runs and chats need Claude: Codex cannot screen tool calls.
export const AGENT_MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', hint: 'Balanced. The default.' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5', hint: 'Strongest, slower and costlier.' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', hint: 'Fast and cheap, for light work.' },
  { id: 'claude-fable-5-2', name: 'Fable 5.2', hint: 'Long, careful work.' },
] as const;

export function modelName(id: string): string {
  return AGENT_MODELS.find((m) => m.id === id)?.name ?? id;
}

export const EFFORTS = ['low', 'medium', 'high', 'max'] as const;
