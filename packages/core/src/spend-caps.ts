import type { SpanRecord } from './trace.ts';

/** Per-project spend limits. A missing cap means "no cap" for that window. */
export interface SpendCaps {
  daily_usd?: number | null;
  monthly_usd?: number | null;
  /** Fraction of a cap (0..1) at which a warning starts. Default 0.8. */
  warn_at?: number;
}

export type SpendWindow = 'daily' | 'monthly';
export type SpendLevel = 'ok' | 'warn' | 'capped';

export interface SpendWindowStatus {
  window: SpendWindow;
  spent_usd: number;
  /** Spans in the window whose cost is unknown (null cost). */
  unknown_cost_spans: number;
  cap_usd: number | null;
  level: SpendLevel;
}

export interface SpendStatus {
  daily: SpendWindowStatus;
  monthly: SpendWindowStatus;
  level: SpendLevel;
  /** Set when new agent work must be refused; shown on the ticket. */
  refusal?: string;
}

export const DEFAULT_SPEND_WARN_AT = 0.8;
const DAY_MS = 86_400_000;

/** Rolling windows: the last 24 hours and the last 30 days, ending at `now`. */
export const SPEND_WINDOW_MS: Record<SpendWindow, number> = {
  daily: DAY_MS,
  monthly: 30 * DAY_MS,
};

function windowStatus(
  window: SpendWindow,
  spans: readonly SpanRecord[],
  caps: SpendCaps,
  now: number,
): SpendWindowStatus {
  const from = now - SPEND_WINDOW_MS[window];
  let spent = 0;
  let unknown = 0;
  for (const span of spans) {
    const at = Date.parse(span.ended_at ?? span.started_at);
    if (!(at > from && at <= now)) continue;
    if (span.cost_usd == null) {
      // Only model spans carry a cost; a null cost on one is an unknown cost.
      if (span.type === 'model') unknown += 1;
      continue;
    }
    spent += span.cost_usd;
  }
  const cap = (window === 'daily' ? caps.daily_usd : caps.monthly_usd) ?? null;
  const warnAt = caps.warn_at ?? DEFAULT_SPEND_WARN_AT;
  let level: SpendLevel = 'ok';
  if (cap !== null && cap > 0) {
    if (spent >= cap) level = 'capped';
    else if (spent >= cap * warnAt) level = 'warn';
  }
  return { window, spent_usd: spent, unknown_cost_spans: unknown, cap_usd: cap, level };
}

/**
 * Decide whether a project may start new agent work. Spend is summed over
 * rolling windows; unknown-cost spans add nothing but are counted so the UI
 * can say the total is a lower bound. Running work is never cut off here: the
 * caller checks this only before starting a turn.
 */
export function spendStatus(
  spans: readonly SpanRecord[],
  caps: SpendCaps,
  now: Date = new Date(),
): SpendStatus {
  const t = now.getTime();
  const daily = windowStatus('daily', spans, caps, t);
  const monthly = windowStatus('monthly', spans, caps, t);
  const level: SpendLevel =
    daily.level === 'capped' || monthly.level === 'capped'
      ? 'capped'
      : daily.level === 'warn' || monthly.level === 'warn'
        ? 'warn'
        : 'ok';
  const status: SpendStatus = { daily, monthly, level };
  const hit = [daily, monthly].find((w) => w.level === 'capped');
  if (hit) {
    status.refusal = `Spend cap reached: $${hit.spent_usd.toFixed(2)} of $${hit.cap_usd!.toFixed(2)} ${hit.window === 'daily' ? 'in the last 24 hours' : 'in the last 30 days'}. New agent work resumes when the window rolls over or the cap is raised.`;
  }
  return status;
}
