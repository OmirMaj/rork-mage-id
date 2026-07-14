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
 * are bright too — so the old always-white bar label was invisible/low-
 * contrast on them. This returns near-black for light fills and white for
 * dark ones, using the YIQ brightness heuristic with a 150 threshold that we
 * hand-checked against every `tradeColors` entry (orange/red/brown/purple →
 * white; cream/yellow/cyan/light-green → dark).
 */
export function barLabelColorFor(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return '#FFFFFF';
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#1F2937' : '#FFFFFF';
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
