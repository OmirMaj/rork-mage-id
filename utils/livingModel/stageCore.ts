// utils/livingModel/stageCore.ts — which stage of work a schedule task is (pure).
//
// The Living Model, Phase 1. The replay draws a room by the STAGE its ticked
// tasks have reached. A schedule task carries no stage, so this file maps a
// task to one with a small table a person can read.
//
// THE TABLE, IN ORDER:
//   0. THE PERSON'S OWN CHOICE. A title can never be read perfectly, so on the
//      Tasks tab a person may pick the stage of a task himself. That choice is
//      kept with the ticks (JobModel.stages) and wins over everything below
//      (`resolveStage`).
//   1. NOT_BUILD_WORK. A title about an inspection, a permit, a delivery, a
//      review, protection, a walk-through, a punch list or cleanup is not one
//      of the building stages, whatever its trade. It is "Other Work".
//   2. NOT_ROOM_WORK. Concrete, footings, slabs, grading and digging are real
//      building work, but not one of the stages a room's walls go through.
//      "Other Work" as well.
//   3. STAGE_BY_WORDS. Plain words in the title: "demo", "framing",
//      "rough-in", "insulation", "drywall", "paint", "tile" and so on. First
//      match wins, top to bottom. THE ORDER IS PART OF THE RULE:
//        - framing is read before rough-in, and the word "rough" alone names
//          no stage ("Rough framing" and "Rough carpentry" are framing; pipes
//          and wires are drawn only for "rough-in", "rough plumbing", "rough
//          electrical" and the like);
//        - "finish carpentry" is read before framing's "carpentry".
//   4. STAGE_BY_TRADE. The task's trade (types/index.ts TradeKey), used only
//      when the title said nothing.
//   5. Otherwise "Other Work".
//
// NOTHING IS GUESSED SILENTLY. A task that maps to no stage is returned as
// 'other' and every view shows it under "Other Work" with its own name. No
// task is ever dropped. scripts/validate-living-model.ts reads TradeKey out of
// types/index.ts and fails if a trade is missing from STAGE_BY_TRADE, and runs
// a list of plain task names (false friends among them) through this table.

import type { TradeKey } from '@/types';

/** The building stages, in the order a room goes through them. */
export const BUILD_STAGES = ['demolition', 'framing', 'rough_in', 'insulation', 'drywall', 'finishes'] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];

/** What one task is: a building stage, or work the stages do not cover. */
export type TaskStage = BuildStage | 'other';

/** What a room shows at one moment. */
export type RoomStage = 'no_tasks' | 'not_started' | BuildStage | 'other' | 'done';

export const TASK_STAGES: readonly TaskStage[] = [...BUILD_STAGES, 'other'];

export const NOT_BUILD_WORK =
  /inspect|permit|deliver|\border\b|procure|walk[\s-]*through|walkthrough|punch|close[\s-]*out|clean[\s-]*up|cleanup|mobiliz|meeting|submittal|sign[\s-]*off|approval|\breview|protect|\bsurvey|\bdumpster|\bsite visit/i;

/** Building work that is not a stage of a room's walls. */
export const NOT_ROOM_WORK =
  /concrete|\bpour(?:s|ed|ing)?\b|footing|foundation|\bslabs?\b|rebar|masonry|\bgrad(?:e|ing)\b|excavat|backfill|\btrench/i;

export const STAGE_BY_WORDS: readonly (readonly [RegExp, BuildStage])[] = [
  [/\bdemo\b|demolition|demolish|tear[\s-]*out|tear[\s-]*down|strip[\s-]*out|\bgut\b|gutting|remove (?:old|existing)/i, 'demolition'],
  [/insulat|vapou?r barrier|\bbatts?\b/i, 'insulation'],
  [/drywall|sheetrock|gypsum|\btap(?:e|ing)\b|\bmud(?:ding)?\b|skim coat|plaster/i, 'drywall'],
  // Before framing, so "Finish carpentry" is not read as carpentry.
  [/\b(?:finish|trim)[\s-]+carpentry|\btrim[\s-]*out\b/i, 'finishes'],
  // Before rough-in, so "Rough framing" and "Rough carpentry" are framing.
  [/\bfram(?:e|es|ed|ing)\b|\bstuds?\b|joist|truss|sheathing|subfloor|\bheaders?\b|\bbeams?\b|\bcarpentry\b|\bblocking\b/i, 'framing'],
  // The word "rough" alone names no stage: it has to say rough WHAT.
  [/rough[\s-]*ins?\b|\brough[\s-]+(?:plumb|electric|mechanical|hvac|wir|gas|duct|low[\s-]*volt)|wiring|\bwires?\b|conduit|\bpip(?:e|es|ing)\b|ductwork|\bducts?\b|supply lines?|drain lines?/i, 'rough_in'],
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
  /** How it was decided, so a view can say so. 'person' = he picked it himself on the Tasks tab. */
  by: 'person' | 'not_build_work' | 'words' | 'trade' | 'nothing';
}

/** The stage of one task from its title and its trade. Never throws, never returns nothing. */
export function stageForTask(title: string | null | undefined, trade: TradeKey | null | undefined): StageAnswer {
  const name = title ?? '';
  if (NOT_BUILD_WORK.test(name) || NOT_ROOM_WORK.test(name)) return { stage: 'other', by: 'not_build_work' };
  for (const [re, stage] of STAGE_BY_WORDS) {
    if (re.test(name)) return { stage, by: 'words' };
  }
  if (trade && Object.prototype.hasOwnProperty.call(STAGE_BY_TRADE, trade)) {
    const stage = STAGE_BY_TRADE[trade];
    return { stage, by: stage === 'other' ? 'nothing' : 'trade' };
  }
  return { stage: 'other', by: 'nothing' };
}

export const isTaskStage = (v: unknown): v is TaskStage => typeof v === 'string' && (TASK_STAGES as readonly string[]).includes(v);

/** The stage of one task: the person's own choice when he made one, the table otherwise. */
export function resolveStage(title: string | null | undefined, trade: TradeKey | null | undefined, chosen: unknown): StageAnswer {
  if (isTaskStage(chosen)) return { stage: chosen, by: 'person' };
  return stageForTask(title, trade);
}

export const stageOrder = (s: BuildStage): number => BUILD_STAGES.indexOf(s);
