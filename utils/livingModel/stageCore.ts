// utils/livingModel/stageCore.ts — which stage of work a schedule task is (pure).
//
// The Living Model, Phase 1. The replay draws a room by the STAGE its ticked
// tasks have reached. A schedule task carries no stage, so this file maps a
// task to one with a small table a person can read.
//
// THE TABLE, IN ORDER:
//   1. NOT_BUILD_WORK. A title about an inspection, a permit, a delivery, a
//      walk-through, a punch list or cleanup is not one of the building stages,
//      whatever its trade. It is "Other Work".
//   2. STAGE_BY_WORDS. Plain words in the title: "demo", "framing",
//      "rough-in", "insulation", "drywall", "paint", "tile" and so on. First
//      match wins, top to bottom.
//   3. STAGE_BY_TRADE. The task's trade (types/index.ts TradeKey), used only
//      when the title said nothing.
//   4. Otherwise "Other Work".
//
// NOTHING IS GUESSED SILENTLY. A task that maps to no stage is returned as
// 'other' and every view shows it under "Other Work" with its own name. No
// task is ever dropped. scripts/validate-living-model.ts reads TradeKey out of
// types/index.ts and fails if a trade is missing from STAGE_BY_TRADE.

import type { TradeKey } from '@/types';

/** The building stages, in the order a room goes through them. */
export const BUILD_STAGES = ['demolition', 'framing', 'rough_in', 'insulation', 'drywall', 'finishes'] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];

/** What one task is: a building stage, or work the stages do not cover. */
export type TaskStage = BuildStage | 'other';

/** What a room shows at one moment. */
export type RoomStage = 'no_tasks' | 'not_started' | BuildStage | 'other' | 'done';

export const NOT_BUILD_WORK =
  /inspect|permit|deliver|\border\b|procure|walk[\s-]*through|walkthrough|punch|close[\s-]*out|clean[\s-]*up|cleanup|mobiliz|meeting|submittal|sign[\s-]*off|approval/i;

export const STAGE_BY_WORDS: readonly (readonly [RegExp, BuildStage])[] = [
  [/\bdemo\b|demolition|demolish|tear[\s-]*out|tear[\s-]*down|strip[\s-]*out|\bgut\b|gutting|remove (?:old|existing)/i, 'demolition'],
  [/insulat|vapou?r barrier|\bbatts?\b/i, 'insulation'],
  [/drywall|sheetrock|gypsum|\btap(?:e|ing)\b|\bmud(?:ding)?\b|skim coat|plaster/i, 'drywall'],
  [/rough[\s-]*in|\brough\b|wiring|\bwires?\b|conduit|\bpip(?:e|es|ing)\b|ductwork|\bducts?\b|supply lines?|drain lines?/i, 'rough_in'],
  [/\bfram(?:e|es|ing)\b|\bstuds?\b|joist|truss|sheathing|subfloor|\bheaders?\b|\bbeams?\b/i, 'framing'],
  [/paint|primer|\bprime\b|\btile|floor|\btrim|cabinet|counter|fixture|finish|millwork|backsplash|hardware|appliance|casing|baseboard|carpet|grout|vanity|\bdoors?\b/i, 'finishes'],
];

export const STAGE_BY_TRADE: Readonly<Record<TradeKey, TaskStage>> = {
  demo: 'demolition',
  framing: 'framing',
  steel: 'framing',
  electrical: 'rough_in',
  plumbing: 'rough_in',
  hvac: 'rough_in',
  finish: 'finishes',
  // No stage of a room's interior: said plainly as Other Work.
  general: 'other',
  concrete: 'other',
  roofing: 'other',
  landscaping: 'other',
  closeout: 'other',
};

export interface StageAnswer {
  stage: TaskStage;
  /** How it was decided, so a view can say so. */
  by: 'not_build_work' | 'words' | 'trade' | 'nothing';
}

/** The stage of one task from its title and its trade. Never throws, never returns nothing. */
export function stageForTask(title: string | null | undefined, trade: TradeKey | null | undefined): StageAnswer {
  const name = title ?? '';
  if (NOT_BUILD_WORK.test(name)) return { stage: 'other', by: 'not_build_work' };
  for (const [re, stage] of STAGE_BY_WORDS) {
    if (re.test(name)) return { stage, by: 'words' };
  }
  if (trade && Object.prototype.hasOwnProperty.call(STAGE_BY_TRADE, trade)) {
    const stage = STAGE_BY_TRADE[trade];
    return { stage, by: stage === 'other' ? 'nothing' : 'trade' };
  }
  return { stage: 'other', by: 'nothing' };
}

export const stageOrder = (s: BuildStage): number => BUILD_STAGES.indexOf(s);
