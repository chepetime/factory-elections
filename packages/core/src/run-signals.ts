// Waste signals of a run, computed from its spans alone at $0: no model judge, no second copy of
// span data. A tool span keeps only the tool name, a 200-character input summary (the command or
// the path) and the outcome, so the signals are shapes of the call sequence: edit churn, repeated
// calls, A/B/A/B oscillation, fail-fix loops and failure streaks. See docs/vision/tracing-and-metrics.md
// for what each signal can and cannot see.
import type { SpanRecord } from './trace.ts';

export type RunCategory = 'thrash' | 'errors' | 'failed' | 'fine';
export type WasteKind = 'fail-fix' | 'repeat' | 'oscillation' | 'churn' | 'failure-streak';

export interface RunSignals {
  trace_id: string;
  project: string;
  task_id?: string;
  task_class?: string;
  /** Who ran it: the provider of its model calls, else the run's step or name. */
  source?: string;
  /** The main waste of the run: its kind, and the tool and input shape of its first wasted call. */
  pattern?: { kind: WasteKind; tool: string; shape: string };
  tool_calls: number;
  /** The most edits of one path. */
  edit_churn: number;
  /** Calls beyond the first of an identical (name, normalized input) call made at least 3 times. */
  repeated_calls: number;
  /** A/B/A/B runs of two alternating calls. */
  oscillations: number;
  /** A check command failed, files were edited, and the same check failed again. */
  fail_fix_loops: number;
  /** The most failed tool calls in a row. */
  max_failure_streak: number;
  /** Coder calls that ended with an empty final message. */
  empty_answers: number;
  wasted_calls: number;
  /** wasted_calls / tool_calls. */
  waste_ratio: number;
  /** Run cost × waste_ratio. Null when a span of the run reported no cost (Codex). */
  wasted_usd: number | null;
  /** Run input and output tokens × waste_ratio: the rank for runs whose cost is unknown. */
  wasted_tokens: number;
  category: RunCategory;
}

/** Edits of one path from which the later edits count as waste. */
export const CHURN_EDITS = 5;
export const REPEAT_CALLS = 3;
export const FAILURE_STREAK = 3;

const EDIT_TOOLS = /^(edit|write|multiedit|notebookedit)$/i;
const OBSERVE_TOOLS =
  /^(read|grep|glob|ls|notebookread|webfetch|websearch|todowrite|toolsearch)$|screenshot|snapshot/i;
const OBSERVE_COMMAND =
  /^\s*(ls|cat|head|tail|pwd|echo|grep|rg|find|wc|which|stat|git\s+(status|log|diff|show|branch|rev-parse)|gh\s+\S+\s+(view|status|checks|list)|docker\s+(ps|logs)|kubectl\s+(get|logs|describe))\b|screenshot|\blogs?\b|\bstatus\b/i;

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Blanks hashes, paths and numbers, so the same call on another file or run id still matches. */
export function normalizeInput(input: string): string {
  return collapse(input)
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/g, '#')
    .replace(/(?:~|\.{1,2})?(?:\/[\w.@+-]+)+|[\w.@+-]+(?:\/[\w.@+-]+)+/g, '<path>')
    .replace(/\d+/g, '#');
}

interface Call {
  name: string;
  input: string;
  failed: boolean;
  edit: boolean;
  /** An observation: a status read, `ls`, a log read, a screenshot. */
  observe: boolean;
  /** The verification command this call runs, if any. */
  check?: string;
  key: string;
}

function toCalls(tools: readonly SpanRecord[], verification: readonly string[]): Call[] {
  const parts = verification
    .flatMap((command) => command.split(/&&|\|\||;/))
    .map(collapse)
    .filter((part) => part.length >= 3);
  return tools.map((span) => {
    const input = String(span.attributes?.input ?? '').replace(/…$/, '');
    const edit = EDIT_TOOLS.test(span.name);
    const command = /^bash$/i.test(span.name) ? collapse(input) : '';
    const check = command ? parts.find((part) => command.includes(part)) : undefined;
    const observe =
      !edit && !check && (OBSERVE_TOOLS.test(span.name) || (!!command && OBSERVE_COMMAND.test(command)));
    return {
      name: span.name,
      input,
      failed: span.outcome === 'failed',
      edit,
      observe,
      ...(check ? { check } : {}),
      // An edit is identified by its path: blanking paths would make every edit the same call.
      key: `${span.name}\0${edit ? input : normalizeInput(input)}`,
    };
  });
}

/** Marks the waste in a call sequence: indexes of calls that added nothing. */
type Counts = Pick<
  RunSignals,
  'edit_churn' | 'repeated_calls' | 'oscillations' | 'fail_fix_loops' | 'max_failure_streak'
>;

function wastePattern(calls: readonly Call[], found: ReturnType<typeof findWaste>): RunSignals['pattern'] {
  const kind: WasteKind | undefined =
    found.fail_fix_loops > 0
      ? 'fail-fix'
      : found.repeated_calls > 0
        ? 'repeat'
        : found.oscillations > 0
          ? 'oscillation'
          : found.edit_churn >= CHURN_EDITS
            ? 'churn'
            : found.max_failure_streak >= FAILURE_STREAK
              ? 'failure-streak'
              : undefined;
  const first = Math.min(...found.wasted);
  const call = calls[first];
  if (!kind || !call) return undefined;
  // An edit is told apart by its path, which the shape drops: churn groups by tool alone.
  return { kind, tool: call.name, shape: call.edit ? '' : normalizeInput(call.input).slice(0, 120) };
}

function findWaste(calls: readonly Call[]): Counts & { wasted: Set<number> } {
  const wasted = new Set<number>();

  // Edit churn: the later edits of a path edited too often.
  const edits = new Map<string, number[]>();
  calls.forEach((call, index) => {
    if (!call.edit) return;
    for (const path of call.input.split(', ').filter(Boolean)) {
      const list = edits.get(path) ?? [];
      list.push(index);
      edits.set(path, list);
    }
  });
  let editChurn = 0;
  for (const list of edits.values()) {
    editChurn = Math.max(editChurn, list.length);
    if (list.length >= CHURN_EDITS) for (const index of list.slice(1)) wasted.add(index);
  }

  // Repeats: identical calls three or more times. Edits (churn) and observations are exempt.
  const groups = new Map<string, number[]>();
  calls.forEach((call, index) => {
    if (call.edit || call.observe) return;
    const list = groups.get(call.key) ?? [];
    list.push(index);
    groups.set(call.key, list);
  });
  let repeated = 0;
  for (const list of groups.values()) {
    if (list.length < REPEAT_CALLS) continue;
    repeated += list.length - 1;
    for (const index of list.slice(1)) wasted.add(index);
  }

  // Oscillation: two different calls alternating at least twice. Checks belong to the fail-fix rule.
  const steps = calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => !call.observe && !call.check);
  let oscillations = 0;
  for (let i = 0; i + 3 < steps.length;) {
    const k = (n: number) => steps[n]!.call.key;
    if (k(i) !== k(i + 1) && k(i) === k(i + 2) && k(i + 1) === k(i + 3)) {
      let end = i + 4;
      while (end < steps.length && k(end) === k(end - 2)) end++;
      oscillations++;
      for (let n = i + 2; n < end; n++) wasted.add(steps[n]!.index);
      i = end;
    } else i++;
  }

  // Fail-fix loops: a check fails, a file is edited, the same check fails again.
  const state = new Map<string, { failed: boolean; edited: boolean }>();
  let failFix = 0;
  calls.forEach((call, index) => {
    if (call.edit) for (const s of state.values()) if (s.failed) s.edited = true;
    if (!call.check) return;
    const s = state.get(call.check) ?? { failed: false, edited: false };
    state.set(call.check, s);
    if (!call.failed) {
      s.failed = false;
      s.edited = false;
      return;
    }
    if (s.failed && s.edited) {
      failFix++;
      wasted.add(index);
    }
    s.failed = true;
    s.edited = false;
  });

  // Failure streaks: from the third failed call in a row on, nothing was learned.
  let streak = 0;
  let maxStreak = 0;
  calls.forEach((call, index) => {
    streak = call.failed ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
    if (streak >= FAILURE_STREAK) wasted.add(index);
  });

  return {
    edit_churn: editChurn,
    repeated_calls: repeated,
    oscillations,
    fail_fix_loops: failFix,
    max_failure_streak: maxStreak,
    wasted,
  };
}

/** Signals of every run (a trace with a run span) in `spans`. Pure: ranking is the caller's job. */
export function runSignals(spans: readonly SpanRecord[]): RunSignals[] {
  const traces = new Map<string, SpanRecord[]>();
  for (const span of spans) {
    const key = `${span.project}\0${span.trace_id}`;
    const list = traces.get(key);
    if (list) list.push(span);
    else traces.set(key, [span]);
  }
  const out: RunSignals[] = [];
  for (const group of traces.values()) {
    const run = group.find((s) => s.type === 'run');
    if (!run) continue;
    // Sort is stable: tool spans that start in the same millisecond keep their ledger order.
    const tools = group
      .filter((s) => s.type === 'tool')
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    const toolCalls = toCalls(tools, run.replay?.verification ?? []);
    const found = findWaste(toolCalls);
    const pattern = wastePattern(toolCalls, found);
    const { wasted, ...counts } = found;
    const wastedCalls = wasted.size;
    const ratio = tools.length ? wastedCalls / tools.length : 0;
    const costKnown = group.every((s) => s.cost_usd !== null);
    const cost = group.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
    const calls = group.filter((s) => s.type === 'model' || s.type === 'child');
    const tokens = calls.reduce((sum, s) => sum + (s.tokens?.input ?? 0) + (s.tokens?.output ?? 0), 0);
    const emptyAnswers = group.filter(
      (s) =>
        s.type === 'model' &&
        s.step === 'coder' &&
        s.outcome === 'completed' &&
        s.attributes?.final_chars === 0,
    ).length;
    const failedCalls = tools.filter((s) => s.outcome === 'failed').length;
    const thrash =
      counts.edit_churn >= CHURN_EDITS ||
      counts.repeated_calls > 0 ||
      counts.oscillations > 0 ||
      counts.fail_fix_loops > 0;
    const errors =
      counts.max_failure_streak >= FAILURE_STREAK ||
      emptyAnswers > 0 ||
      (tools.length >= 4 && failedCalls / tools.length >= 0.5);
    const source = group.find((s) => s.type === 'model' && s.provider)?.provider ?? run.step ?? run.name;
    out.push({
      trace_id: run.trace_id,
      project: run.project,
      ...(run.task_id ? { task_id: run.task_id } : {}),
      ...(run.task_class ? { task_class: run.task_class } : {}),
      source,
      ...(pattern ? { pattern } : {}),
      tool_calls: tools.length,
      ...counts,
      empty_answers: emptyAnswers,
      wasted_calls: wastedCalls,
      waste_ratio: ratio,
      wasted_usd: costKnown ? cost * ratio : null,
      wasted_tokens: Math.round(tokens * ratio),
      category: thrash ? 'thrash' : errors ? 'errors' : run.outcome !== 'completed' ? 'failed' : 'fine',
    });
  }
  return out;
}

/** The runs that wasted the most: known dollars first, then runs of unknown cost by wasted tokens. */
export function rankWaste(signals: readonly RunSignals[], limit = 10): RunSignals[] {
  return signals
    .filter((s) => s.wasted_calls > 0)
    .sort(
      (a, b) =>
        (a.wasted_usd === null ? 1 : 0) - (b.wasted_usd === null ? 1 : 0) ||
        (b.wasted_usd ?? 0) - (a.wasted_usd ?? 0) ||
        b.wasted_tokens - a.wasted_tokens,
    )
    .slice(0, limit);
}
