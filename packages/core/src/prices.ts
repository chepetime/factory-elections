import type { Usage } from './agents.ts';

/** Dollars per million tokens for one model. */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
}

/** Bump when any price below changes, so a recorded cost can be traced to the table it used. */
export const PRICE_TABLE_VERSION = '2026-11-27';

/**
 * The one place token prices live, keyed by the bare model name (no provider prefix). A model not
 * listed has an unknown cost: it is never priced at a guessed rate.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
};

/** The price for a model reference such as `codex:gpt-5-codex` or `gpt-5-codex`, or null. */
export function priceFor(model: string | undefined): ModelPrice | null {
  if (!model) return null;
  const bare = model.includes(':') ? model.slice(model.indexOf(':') + 1) : model;
  return MODEL_PRICES[bare] ?? null;
}

/** Dollars for a call's token usage at the model's price, or null when the model has no price. */
export function usageCostUsd(model: string | undefined, usage: Usage | undefined): number | null {
  const price = priceFor(model);
  if (!price || !usage) return null;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  return (
    ((usage.inputTokens - cached) * price.input +
      cached * price.cachedInput +
      usage.outputTokens * price.output) /
    1_000_000
  );
}

/**
 * The token cap that stands for a dollar limit on a model. It uses the model's dearest rate, so
 * the cap never allows more than the limit. Null when the model has no price.
 */
export function tokenCapForModel(model: string | undefined, usd: number): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const dearest = Math.max(price.input, price.output);
  return Math.max(1, Math.floor((usd / dearest) * 1_000_000));
}
