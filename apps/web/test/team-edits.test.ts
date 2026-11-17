import { expect, it } from 'vitest';
import { teamEdits, type TeamEdits } from '@/lib/team-edits';

const member = (email: string) => ({
  email,
  name: email,
  commits: 1,
  firstCommit: 'now',
  lastCommit: 'now',
  tags: [],
});
const initial: TeamEdits = { members: [member('a@test'), member('b@test')], pending: {} };

it('rolls back only the failed member when another assignment succeeds', () => {
  let state = teamEdits(initial, { type: 'start', email: 'a@test', requestId: 1, team: 'A', tags: [] });
  state = teamEdits(state, { type: 'start', email: 'b@test', requestId: 2, team: 'B', tags: ['saved'] });
  state = teamEdits(state, { type: 'settle', email: 'b@test', requestId: 2 });
  state = teamEdits(state, { type: 'settle', email: 'a@test', requestId: 1, error: 'failed A' });
  expect(state.members[0]).toEqual(initial.members[0]);
  expect(state.members[1]).toMatchObject({ team: 'B', tags: ['saved'] });
  expect(state.pending).toEqual({});
  expect(state.error).toBe('failed A');
});

it('serializes each member and ignores stale responses after a retry', () => {
  let state = teamEdits(initial, { type: 'start', email: 'a@test', requestId: 1, team: 'A', tags: [] });
  expect(teamEdits(state, { type: 'start', email: 'a@test', requestId: 2, team: 'B', tags: [] })).toBe(state);
  state = teamEdits(state, { type: 'settle', email: 'a@test', requestId: 1, error: 'retry' });
  state = teamEdits(state, { type: 'start', email: 'a@test', requestId: 3, team: 'C', tags: [] });
  expect(teamEdits(state, { type: 'settle', email: 'a@test', requestId: 1, error: 'late' })).toBe(state);
  expect(state.members[0]?.team).toBe('C');
});
