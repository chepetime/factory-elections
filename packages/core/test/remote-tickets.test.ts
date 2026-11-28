import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTickets } from '../src/index.ts';

test('reads GitHub issues from gh --json, labels with their colors', () => {
  const out = JSON.stringify([
    {
      number: 219,
      title: 'Leaving an organization keeps team memberships',
      labels: [{ id: 'x', name: 'P1', description: 'd', color: 'FBCA04' }],
      state: 'OPEN',
      url: 'https://github.com/o/r/issues/219',
      assignees: [{ login: 'ana', name: 'Ana' }],
      author: { login: 'luis' },
      updatedAt: '2026-11-20T10:00:00Z',
      comments: [{}, {}],
    },
    { number: 217, title: 'Support console', labels: [] },
  ]);
  assert.deepEqual(parseTickets(out), [
    {
      key: '#219',
      title: 'Leaving an organization keeps team memberships',
      labels: [{ name: 'P1', color: 'fbca04' }],
      assignees: ['Ana'],
      state: 'OPEN',
      author: 'luis',
      url: 'https://github.com/o/r/issues/219',
      updated_at: '2026-11-20T10:00:00Z',
      comments: 2,
    },
    { key: '#217', title: 'Support console', labels: [], assignees: [] },
  ]);
});

test('reads Jira records with fields, wrapped in an issues list', () => {
  const out = JSON.stringify({
    issues: [
      {
        key: 'PROJ-12',
        fields: {
          summary: 'Export ballots',
          status: { name: 'In Progress' },
          assignee: { displayName: 'Mika' },
          priority: { name: 'High' },
          issuetype: { name: 'Story' },
          labels: ['backend'],
          updated: '2026-11-21T09:00:00.000+0000',
        },
      },
    ],
  });
  assert.deepEqual(parseTickets(out), [
    {
      key: 'PROJ-12',
      title: 'Export ballots',
      labels: [{ name: 'backend' }],
      assignees: ['Mika'],
      state: 'In Progress',
      priority: 'High',
      type: 'Story',
      updated_at: '2026-11-21T09:00:00.000+0000',
    },
  ]);
});

test('reads Linear-style identifiers, states and label connections', () => {
  const out = JSON.stringify([
    {
      identifier: 'ENG-4',
      title: 'Fix login',
      state: { name: 'Todo' },
      labels: { nodes: [{ name: 'Bug', color: '#eb5757' }] },
    },
  ]);
  assert.deepEqual(parseTickets(out)?.[0], {
    key: 'ENG-4',
    title: 'Fix login',
    labels: [{ name: 'Bug', color: 'eb5757' }],
    assignees: [],
    state: 'Todo',
  });
});

test('leaves text, broken JSON and records that are not tickets to the raw view', () => {
  for (const out of ['PROJ-1  Fix it  Open', '[{"number": 1', '[{"foo": 1}]', '{"count": 3}', ''])
    assert.equal(parseTickets(out), undefined, out);
  assert.deepEqual(parseTickets('[]'), []);
});
