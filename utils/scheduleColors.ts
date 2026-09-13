// utils/scheduleColors.ts — Phase 27 (Pro Scheduler redesign).
//
// Single source for "what color is this task on the Gantt?".
// Used by: InteractiveGantt (bar fill), BoardTab (phase dot),
// DashboardTab (critical-path list trade tag), TaskInspector
// (trade picker default).
//
// Resolution order:
//   1. task.tradeKey if explicitly set
//   2. inferTradeFromName(task.title) regex match
//   3. 'general' fallback (brand amber)
//
// The inference is intentionally conservative — false negatives
// (defaulting to 'general') are better than false positives
// (mis-coloring a "Plumbing inspection" task as plumbing).

import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { labelOn, taskStatusInk } from '@/components/ui/ink';
import type { ScheduleTask, TaskStatus, TradeKey } from '@/types';

export type { TradeKey };  // re-export so existing imports `import { type TradeKey } from '@/utils/scheduleColors'` still work

/**
 * How the Gantt colors its bars.
 *   'status' — by task STATUS (progress signal; the default, see useGanttColorMode)
 *   'trade'  — by task TRADE  (coordination signal; opt-in)
 */
export type GanttColorMode = 'status' | 'trade';

const INFERENCE_RULES: ReadonlyArray<readonly [RegExp, TradeKey]> = [
  [/concrete|foundation|footing|slab|pour|rebar/i, 'concrete'],
  [/frame|framing|stud|joist|beam|truss/i,         'framing'],
  [/electric|wiring|conduit|outlet|circuit/i,      'electrical'],
  [/plumb|pipe|drain|water\s*line|fixture/i,       'plumbing'],
  [/hvac|duct|heating|cooling|ventil|mechanical/i, 'hvac'],
  [/roof|gutter|flashing|shingle/i,                'roofing'],
  [/steel|weld|metal\s*stud/i,                     'steel'],
  [/\bdemo(?:lish|lition)\b|excavat|grade\s*site|tear\s+down/i, 'demo'],
  [/landscap|sod|irrigat|hardscap|paver/i,         'landscaping'],
  [/drywall|paint|trim|tile|floor|finish/i,        'finish'],
  [/punch\s*list|punchlist|inspect|closeout|substantial|final\s*walk/i, 'closeout'],
];

export function inferTradeFromName(name: string | null | undefined): TradeKey {
  if (!name) return 'general';
  for (const [re, key] of INFERENCE_RULES) {
    if (re.test(name)) return key;
  }
  return 'general';
}

export function tradeKeyForTask(task: ScheduleTask): TradeKey {
  if (task.tradeKey) return task.tradeKey;
  return inferTradeFromName(task.title);
}

export function colorForTask(task: ScheduleTask): string {
  return Colors.tradeColors[tradeKeyForTask(task)];
}

// ─────────────────────────────────────────────────────────────────────
// STATUS-driven bar color (the Gantt default).
//
// Why status is the default fill: trade inference above is conservative, so a
// schedule of generic "General crew" tasks collapses to one amber bar per row —
// no signal. Status (done / in-progress / on-hold / not-started) is the
// progress read that field teams actually scan the timeline for.
//
// Mapping is CONSISTENT with GridPane's statusChip(): done=green,
// in_progress=blue, on_hold=amber, not_started=neutral-gray. These are SOLID
// bar fills (not the chip's translucent tint), so we prefer the saturated
// theme tokens (themeColors.success / .info — which are theme-aware and legible
// with barLabelColorFor's white/black text pick) and fall back to the solid
// Colors.statusFills tokens for on_hold/not_started, which ThemeColors has no
// dedicated slot for. Passing themeColors keeps dark-mode contrast correct; it
// is optional so non-React callers (e.g. validators) can still resolve a color.
// ─────────────────────────────────────────────────────────────────────

export function statusColor(
  status: TaskStatus,
  themeColors?: Pick<ThemeColors, 'success' | 'info'>,
): string {
  switch (status) {
    case 'done':        return themeColors?.success ?? Colors.statusFills.done;
    case 'in_progress': return themeColors?.info ?? Colors.statusFills.in_progress;
    case 'on_hold':     return Colors.statusFills.on_hold;
    case 'not_started':
    default:            return Colors.statusFills.not_started;
  }
}

export function statusColorForTask(
  task: ScheduleTask,
  themeColors?: Pick<ThemeColors, 'success' | 'info'>,
): string {
  return statusColor(task.status, themeColors);
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  done: 'Done',
  in_progress: 'Active',
  on_hold: 'Hold',
  not_started: 'To do',
};

export function statusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status];
}

/** Status keys in Gantt legend order (progress left→right). */
export const STATUS_KEYS: readonly TaskStatus[] = [
  'done', 'in_progress', 'on_hold', 'not_started',
] as const;

/**
 * Pick a legible label color for text sitting ON a trade-colored bar.
 *
 * Several trade fills are light — `finish` is #F4EFE6 (almost white), and
 * `demo` (yellow), `electrical`/`plumbing` (cyan) and `landscaping` (green)
 * are bright too — so the always-white bar label this replaced was invisible
 * on them.
 *
 * This used to answer that with a YIQ≥150 brightness proxy. YIQ is not a
 * contrast ratio, so it gets the mid-tones wrong: on the `not_started` bar
 * fill #8E9299 it scored 145.6, fell to the white branch, and put a 3.12:1
 * label on the bar — under the 4.5:1 floor an 11pt bar label has to clear.
 * `labelOn` measures both candidates and returns the winner, so it is never
 * worse. Re-measured over the fills InteractiveGantt actually hands it — the
 * theme's success/info, `Colors.statusFills` and `Colors.tradeColors` — it
 * flips four and improves all four: statusFills.not_started #8E9299 3.12→4.70,
 * tradeColors.roofing 3.49→4.21, tradeColors.closeout 3.45→4.25, and the brand
 * amber #FF6A1A — `tradeColors.general`, the fill every un-inferred task lands
 * on in trade mode — 2.87→5.12. That last one is the visible change: a
 * `general` bar's label goes from white to the near-black ink, which is the
 * same trade founder-decision #1 makes everywhere else (keep the hue, fix the
 * type on it).
 *
 * Three fills still cannot clear AA in EITHER colour and no label picker can
 * fix them — statusFills.in_progress #007AFF tops out at 4.02:1, roofing at
 * 4.21 and closeout at 4.25. That is a fill-value problem in
 * constants/colors.ts, and validate-contrast check 15b records it rather than
 * pretending the palette passes.
 *
 * Kept as a named wrapper rather than replaced at the call site: this is the
 * schedule module's answer to "what colour is this bar's text", and
 * InteractiveGantt reads it from here alongside the fill it pairs with.
 */
export function barLabelColorFor(hex: string): string {
  return labelOn(hex);
}

/**
 * The four status inks, looked up TOTALLY.
 *
 * `taskStatusInk` is a plain Record, so `inks[status]` is only as safe as the
 * type says — and `ScheduleTask['status']` is required by the type but not by
 * the data: a schedule persisted before the field existed hydrates without it,
 * which is why TaskInspector reads `task.status ?? 'not_started'`. An
 * undefined key returns undefined, and `undefined + CHIP_TINT_SUFFIX` is the
 * string "undefined15" — RN's normalizeColor rejects that, so the chip loses
 * its fill and border entirely instead of falling back to grey.
 *
 * `utils/scheduleEngine.ts:getStatusColor`, which the mobile sheet used to
 * call, was total — it had a `default:` arm — so swapping it for a Record
 * lookup would have quietly dropped that. The chip row it feeds today happens
 * not to need it (it maps over a literal status list, so the key is always
 * good); the surfaces that key off `task.status` itself do, which is why
 * app/(tabs)/schedule/index.tsx wrote the same `?? 'not_started'` rule inline
 * at :195. It lives here so the next surface reuses it rather than deriving a
 * third copy — and so the one that already exists has somewhere to collapse
 * onto.
 */
export type TaskStatusInks = ReturnType<typeof taskStatusInk>;

export function statusInkFor(inks: TaskStatusInks, status: TaskStatus | null | undefined): string {
  return inks[status ?? 'not_started'] ?? inks.not_started;
}

const TRADE_LABELS: Record<TradeKey, string> = {
  general: 'General',
  concrete: 'Concrete',
  framing: 'Framing',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  roofing: 'Roofing',
  steel: 'Steel',
  demo: 'Demo',
  landscaping: 'Landscaping',
  finish: 'Finish',
  closeout: 'Closeout',
};

export function tradeLabel(key: TradeKey): string {
  return TRADE_LABELS[key];
}

/** All trade keys in display order — used by TradeKey picker dropdowns. */
export const TRADE_KEYS: readonly TradeKey[] = [
  'general', 'concrete', 'framing', 'electrical', 'plumbing', 'hvac',
  'roofing', 'steel', 'demo', 'landscaping', 'finish', 'closeout',
] as const;
