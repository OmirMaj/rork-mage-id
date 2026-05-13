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
import type { ScheduleTask, TradeKey } from '@/types';

export type { TradeKey };  // re-export so existing imports `import { type TradeKey } from '@/utils/scheduleColors'` still work

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
