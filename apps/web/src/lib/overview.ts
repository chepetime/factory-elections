// Numbers for the home board, computed from a project's task records.
import type { Stage, TaskRecord } from '@factory/core';

export const ACTIVITY_WEEKS = 12;
const NEEDS_YOU: Stage[] = ['awaiting-approval', 'blocked', 'verification-failed', 'failed'];

export interface ActivityDay {
  date: string; // YYYY-MM-DD, local time
  count: number;
}

export interface MonthStat {
  label: string;
  value: string;
  /** Change against last month, already signed, e.g. "+3" or "−$1.20". */
  delta: string;
}

export interface Overview {
  activity: ActivityDay[];
  activityTotal: number;
  recent: TaskRecord[];
  needsYou: TaskRecord[];
  month: MonthStat[];
}

function day(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function inMonth(iso: string | undefined, year: number, month: number): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === year && d.getMonth() === month;
}

function signed(n: number, money = false): string {
  const abs = money ? `$${Math.abs(n).toFixed(2)}` : String(Math.abs(n));
  return `${n < 0 ? '−' : '+'}${abs}`;
}

export function overview(tasks: TaskRecord[], now = new Date()): Overview {
  // Activity: every recorded event, per local day, for the last ACTIVITY_WEEKS weeks ending today.
  const counts = new Map<string, number>();
  for (const task of tasks)
    for (const event of task.events ?? []) {
      const key = day(new Date(event.at));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (ACTIVITY_WEEKS * 7 - 1));
  const activity: ActivityDay[] = [];
  for (let i = 0; i < ACTIVITY_WEEKS * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    activity.push({ date: day(d), count: counts.get(day(d)) ?? 0 });
  }

  const newest = [...tasks].sort((a, b) =>
    (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? ''),
  );

  const y = now.getFullYear();
  const m = now.getMonth();
  const prev = new Date(y, m - 1, 1);
  const stats = (year: number, month: number) => ({
    created: tasks.filter((t) => inMonth(t.created_at, year, month)).length,
    prs: tasks.filter((t) => inMonth(t.pr?.at, year, month)).length,
    spend: tasks
      .flatMap((t) => t.attempts ?? [])
      .filter((a) => inMonth(a.finished_at, year, month))
      .reduce((sum, a) => sum + (a.cost_usd ?? 0), 0),
  });
  const cur = stats(y, m);
  const last = stats(prev.getFullYear(), prev.getMonth());

  return {
    activity,
    activityTotal: activity.reduce((sum, d) => sum + d.count, 0),
    recent: newest,
    needsYou: newest.filter((t) => NEEDS_YOU.includes(t.stage)),
    month: [
      { label: 'Runs started', value: String(cur.created), delta: signed(cur.created - last.created) },
      { label: 'Pull requests opened', value: String(cur.prs), delta: signed(cur.prs - last.prs) },
      {
        label: 'Model spend',
        value: `$${cur.spend.toFixed(2)}`,
        delta: signed(cur.spend - last.spend, true),
      },
    ],
  };
}
