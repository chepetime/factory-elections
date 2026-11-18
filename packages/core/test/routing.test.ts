import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { RouteContext, RouteDecision } from '../src/routing.ts';

test('route contracts validate budgets and history', () => {
  const route = { provider: 'claude', model: 'sonnet', effort: 'medium', gateway: 'direct', budget_usd: 2 };
  assert.equal(RouteDecision.safeParse(route).success, true);
  assert.equal(RouteDecision.safeParse({ ...route, budget_usd: -1 }).success, false);
  const context = {
    step: 'review',
    task_class: 'fix',
    size: 'small',
    risk: 'low',
    history: [],
    provider_health: [],
    budget_left_usd: 3,
  };
  assert.equal(RouteContext.safeParse(context).success, true);
  assert.equal(
    RouteContext.safeParse({
      ...context,
      history: [{ provider: 'claude', model: 'sonnet', runs: 1, first_passes: 2, median_cost_usd: 1 }],
    }).success,
    false,
  );
});
