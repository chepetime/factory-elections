import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FeatureCommand,
  FeatureStage,
  Ticket,
  featureActions,
  featureCommandBlockers,
  featureEnded,
  type FeatureFacts,
} from '../src/index.ts';

const ticket = (id: string, over: Partial<Ticket> = {}): Ticket =>
  Ticket.parse({ id, title: `Ticket ${id}`, description: 'd', acceptance: ['a'], size: 'S', ...over });
const facts = (stage: FeatureStage, over: Partial<FeatureFacts> = {}): FeatureFacts => ({
  stage,
  grill: { turns: [] },
  tickets: [],
  has_spec: true,
  ...over,
});
const allowed = (feature: FeatureFacts, busy = false) =>
  featureActions(feature, busy)
    .filter((a) => a.allowed)
    .map((a) => a.action);

test('every feature stage has an explicit command policy', () => {
  const board = { tickets: [ticket('T1')] };
  const expected: Record<FeatureStage, FeatureCommand[]> = {
    grilling: ['grill', 'skip-grill', 'write-spec', 'cancel'],
    spec: ['write-spec', 'save-spec', 'approve-spec', 'cancel'],
    'spec-approved': ['save-spec', 'plan', 'cancel'],
    board: ['plan', 'save-board', 'approve-board', 'cancel'],
    implementing: ['write-qa', 'cancel'],
    qa: ['write-qa', 'complete', 'cancel'],
    done: [],
    cancelled: [],
  };
  for (const stage of FeatureStage.options)
    assert.deepEqual(allowed(facts(stage, board)), expected[stage], stage);
});

test('a running agent step blocks every command except cancel', () => {
  for (const stage of FeatureStage.options)
    assert.deepEqual(allowed(facts(stage), true), featureEnded(stage) ? [] : ['cancel'], stage);
  assert.equal(featureCommandBlockers(facts('spec'), 'approve-spec', { busy: true })[0]!.code, 'busy');
});

test('content rules: an answer, a spec and a board are needed before their commands', () => {
  const asked = facts('grilling', { grill: { turns: [{ at: 'now', role: 'agent', text: 'Q1?' }] } });
  assert.equal(featureCommandBlockers(asked, 'grill', { busy: false })[0]!.code, 'answer-required');
  assert.deepEqual(featureCommandBlockers(asked, 'grill', { busy: false, text: 'Voters.' }), []);
  // Discovery lists the answer as an input: the snapshot is taken before the person writes it.
  const grill = featureActions(asked, false).find((a) => a.action === 'grill')!;
  assert.deepEqual([grill.allowed, grill.requires], [true, ['text']]);
  assert.deepEqual(featureActions(facts('grilling'), false)[0]!.requires, []);

  const noSpec = featureCommandBlockers(facts('spec', { has_spec: false }), 'approve-spec', { busy: false });
  assert.equal(noSpec[0]!.code, 'spec-missing');
  assert.equal(
    featureCommandBlockers(facts('board'), 'approve-board', { busy: false })[0]!.code,
    'board-empty',
  );
});

test('ticket commands list the tickets they accept', () => {
  const feature = facts('implementing', {
    tickets: [
      ticket('T1', { state: 'failed', task_id: 'a' }),
      ticket('T2', { state: 'failed' }),
      ticket('T3', { state: 'waiting-merge', blocked_by: ['T1', 'T2'] }),
      ticket('T4', { blocked_by: ['T1', 'T2'], blockers_merged_at: 'now' }),
      ticket('T5', { blocked_by: ['T1'] }),
    ],
  });
  const actions = new Map(featureActions(feature, false).map((a) => [a.action, a]));
  assert.deepEqual(actions.get('retry-ticket')!.tickets, ['T1']);
  assert.deepEqual(actions.get('mark-merged')!.tickets, ['T3']);
  assert.deepEqual(actions.get('retry-ticket')!.requires, ['ticket']);

  const none = featureActions(facts('implementing', { tickets: [ticket('T1')] }), false);
  const retry = none.find((a) => a.action === 'retry-ticket')!;
  assert.deepEqual([retry.allowed, retry.blockers[0]!.code, retry.tickets], [false, 'ticket', []]);
});

test('a refusal names the stages a command needs, and an ended feature says it is closed', () => {
  assert.equal(
    featureCommandBlockers(facts('spec'), 'plan', { busy: false })[0]!.message,
    '"plan" needs the feature in spec-approved or board; it is spec',
  );
  assert.match(featureCommandBlockers(facts('done'), 'cancel', { busy: false })[0]!.message, /is done/);
});
