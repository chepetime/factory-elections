import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUncappedUnknownCost,
  tokenCapForModel,
  unknownCostCount,
  usageCostUsd,
  workSpend,
  type TaskRecord,
} from '../src/index.ts';

test('a Codex span costs tokens × the model price, with cached input at its own rate', () => {
  const usage = { inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 100_000 };
  // 600k fresh × $1.25 + 400k cached × $0.125 + 100k out × $10, per million.
  assert.equal(usageCostUsd('codex:gpt-5-codex', usage), 0.75 + 0.05 + 1);
  assert.equal(usageCostUsd('gpt-5-codex', usage), 1.8);
});

test('a model with no price, or a call with no usage, has an unknown cost, never a guess', () => {
  const usage = { inputTokens: 10, outputTokens: 10 };
  assert.equal(usageCostUsd('codex:made-up', usage), null);
  assert.equal(usageCostUsd('codex', usage), null);
  assert.equal(usageCostUsd('codex:gpt-5-codex', undefined), null);
  assert.equal(tokenCapForModel('codex:made-up', 1), null);
});

test('the token cap uses the model price: a dollar buys fewer tokens at the dearest rate', () => {
  assert.equal(tokenCapForModel('codex:gpt-5-codex', 1), 100_000);
  assert.equal(tokenCapForModel('codex:gpt-5.1-codex-mini', 1), 500_000);
});

test('a null-cost attempt is counted as unknown, not $0, and an unpriced one is uncapped', () => {
  const attempt = (model: string, cost_usd: number | null) => ({
    step: 'coder',
    rung: 'a',
    model,
    effort: 'medium',
    started_at: '2026-11-27T00:00:00.000Z',
    finished_at: '2026-11-27T00:01:00.000Z',
    outcome: 'completed',
    cost_usd,
  });
  const task = (attempts: unknown[]) => ({ attempts }) as unknown as TaskRecord;
  const known = task([attempt('codex:gpt-5-codex', 0.5)]);
  assert.equal(unknownCostCount(known), 0);
  assert.equal(hasUncappedUnknownCost(known), false);
  const mixed = task([attempt('codex:gpt-5-codex', 0.5), attempt('codex:made-up', null)]);
  assert.equal(workSpend(mixed), 0.5);
  assert.equal(unknownCostCount(mixed), 1);
  assert.equal(hasUncappedUnknownCost(mixed), true);
});
