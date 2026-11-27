import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertMention, mentionAt, parseMentions, workSpend, TaskRecord } from '../src/index.ts';

test('parseMentions finds known agents once, in order, case-insensitive, not in code or emails', () => {
  assert.deepEqual(parseMentions('@Mika and @devin, then @mika again', ['devin', 'mika']), ['mika', 'devin']);
  assert.deepEqual(parseMentions('mail me@devin.com; run `@devin`; ```\n@mika\n```', ['devin', 'mika']), []);
  assert.deepEqual(parseMentions('(@devin) @nobody', ['devin']), ['devin']);
});

test('mentionAt reads the mention typed at the caret; insertMention replaces it with @id and a space', () => {
  assert.deepEqual(mentionAt('Hi @de', 6), { start: 3, query: 'de' });
  assert.deepEqual(mentionAt('@', 1), { start: 0, query: '' });
  assert.equal(mentionAt('me@de', 5), undefined, 'not inside a word');
  assert.equal(mentionAt('@de x', 5), undefined, 'not after a space');
  assert.deepEqual(insertMention('Hi @de, ok', 3, 6, 'devin'), { text: 'Hi @devin , ok', caret: 10 });
  assert.deepEqual(insertMention('Hi @devxx later', 3, 6, 'devin'), { text: 'Hi @devin later', caret: 10 });
});

test('workSpend counts only the attempts since the latest follow-up', () => {
  const attempt = (at: string, cost: number | null) => ({
    step: 'agent',
    rung: 'r',
    model: 'm',
    effort: 'high' as const,
    started_at: at,
    finished_at: at,
    outcome: 'completed' as const,
    cost_usd: cost,
  });
  const task = TaskRecord.parse({
    id: '11111111-2222-4333-8444-555555555555',
    project: 'demo',
    repo: '/r',
    prompt: 'x',
    stage: 'coding',
    attempts: [
      attempt('2026-11-25T10:00:00.000Z', 8),
      attempt('2026-11-26T10:00:00.000Z', 2),
      attempt('2026-11-26T11:00:00.000Z', null),
    ],
  });
  assert.equal(workSpend(task), 10, 'no follow-up: the whole task');
  const followed = {
    ...task,
    follow_ups: [
      {
        at: '2026-11-26T09:00:00.000Z',
        kind: 'conflicts' as const,
        note: 'n',
        agent: 'devin',
        by: 'factory',
      },
    ],
  };
  assert.equal(workSpend(followed as TaskRecord), 2);
});

test('a follow-up that asks to merge or rebase on the base, or to resolve conflicts, is a base merge', async () => {
  const { asksForBaseMerge } = await import('../src/index.ts');
  for (const yes of [
    '@devin Resolve the ci conflicts in the PR',
    'Merge main into this branch and run the tests',
    'Please rebase on main',
    'update the branch with main',
    'bring main into the PR',
  ])
    assert.equal(asksForBaseMerge(yes), true, yes);
  for (const no of ['Fix the copy on the landing page', 'The main menu is broken', 'Update the README'])
    assert.equal(asksForBaseMerge(no), false, no);
});

test('agents may not merge, rebase or pull the base; the factory does it', async () => {
  const { baseSyncCommand, BASE_SYNC_NOTE } = await import('../src/index.ts');
  assert.equal(baseSyncCommand('git merge origin/main'), 'git merge origin/main');
  assert.equal(baseSyncCommand('git fetch origin && git rebase origin/main'), 'git rebase origin/main');
  assert.equal(baseSyncCommand('git pull'), 'git pull');
  assert.equal(baseSyncCommand('git merge --abort'), undefined, 'leaving a merge is fine');
  assert.equal(baseSyncCommand('git status; git log --oneline main..HEAD'), undefined);
  assert.match(BASE_SYNC_NOTE, /Do not run git merge, rebase or pull yourself/);
});
