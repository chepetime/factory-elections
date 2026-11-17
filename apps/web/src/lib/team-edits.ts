// Optimistic assignments are transactions for one member, never snapshots of the whole table.
import type { TeamMember } from './team';

export interface TeamEdits {
  members: TeamMember[];
  pending: Record<string, { requestId: number; before: TeamMember }>;
  error?: string;
}
export type TeamEdit =
  | { type: 'start'; email: string; requestId: number; team?: string; tags: string[] }
  | { type: 'settle'; email: string; requestId: number; error?: string };

export function teamEdits(state: TeamEdits, event: TeamEdit): TeamEdits {
  const pending = state.pending[event.email];
  if (event.type === 'start') {
    const before = state.members.find((m) => m.email === event.email);
    if (!before || pending) return state;
    return {
      members: state.members.map((m) =>
        m.email === event.email ? { ...m, team: event.team, tags: event.tags } : m,
      ),
      pending: { ...state.pending, [event.email]: { requestId: event.requestId, before } },
    };
  }
  if (!pending || pending.requestId !== event.requestId) return state;
  const next = { ...state.pending };
  delete next[event.email];
  return {
    members: event.error
      ? state.members.map((m) => (m.email === event.email ? pending.before : m))
      : state.members,
    pending: next,
    error: event.error ?? state.error,
  };
}
