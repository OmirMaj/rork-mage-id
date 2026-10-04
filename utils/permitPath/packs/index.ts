// utils/permitPath/packs/index.ts — every question pack, in the order the
// engine walks them, plus the sources they cite. PURE DATA.
//
// Order: base, nyc, li_village, li_common, nassau, suffolk. The engine shows
// questions in pack order then question order, except that the permit-office
// question (li.village_or_town) leads (utils/permitPath/interview.ts).

import type { Party, QuestionPack } from '../types';
import { BASE_PACK } from './base';
import { LI_COMMON_PACK, LI_VILLAGE_PACK, NASSAU_PACK, SUFFOLK_PACK } from './longIsland';
import { NYC_PACK } from './nyc';

export { SOURCES, SOURCE_IDS, SOURCE_REFS, FACTS_CHECKED_ON, TO_CONFIRM, sourceRef, sourceIdOf } from './sources';
export type { FactSource, SourceId, ToConfirm } from './sources';
export { TRADE_HINTS } from './tradeHints';
export {
  BASE_PACK,
  LI_COUNTIES,
  YES,
  NO,
  UNSURE,
  YES_NO_UNSURE,
  WORK_TYPE_CHOICES,
  RESIDENTIAL_CHOICES,
} from './base';
export type { WorkTypeChoiceId } from './base';
export { NYC_PACK } from './nyc';
export { LI_COMMON_PACK, LI_VILLAGE_PACK, NASSAU_PACK, SUFFOLK_PACK } from './longIsland';

export const ALL_PACKS: readonly QuestionPack[] = Object.freeze([
  BASE_PACK,
  NYC_PACK,
  LI_VILLAGE_PACK,
  LI_COMMON_PACK,
  NASSAU_PACK,
  SUFFOLK_PACK,
]);

/**
 * Pack items the ENGINE fills from runtime data (buildRoute.ts ENGINE_SLOT_IDS):
 *   nyc.zoning_fact  `{zoning}` and `{plutoVersion}` from the parcel; left out
 *                    unless the parcel read is ok and zoning is non-empty.
 *   li.office        the PermitOffice title, phone and hours. Raised to verified
 *                    only for a hand-verified office, with that office's own
 *                    sourceLabel and sourceUrl; otherwise unknown (name-only
 *                    offices also show NAME_ONLY_BADGE).
 * They are the only items allowed `{name}` placeholders. The engine also
 * fills li.village_caution (longIsland.ts), which carries VILLAGE_CAUTION
 * verbatim and no placeholder. li.office and li.village_caution are the only
 * Long Island lines the engine may raise to verified, and only from the office
 * row's own source, never from a pack.
 */
export const SLOT_ITEM_IDS: readonly string[] = Object.freeze(['nyc.zoning_fact', 'li.office']);

/**
 * The line a readiness row shows when it should name the document rather than
 * repeat the rule. Falls back to the item's own text.
 */
export const READINESS_LABEL: Readonly<Record<string, string>> = Object.freeze({
  'nyc.hic': 'NYC DCWP Home Improvement Contractor license number',
  'nyc.acp5': 'ACP-5 or ACP-7 from the investigator',
  'nyc.lpc': 'LPC permit (CNE, PMW or C of A)',
  'nyc.lpc_interior': 'LPC permit (CNE, PMW or C of A)',
  'li.nassau_hic': 'Nassau County home improvement license number',
  'li.suffolk_hic': 'Suffolk County home improvement license number',
});

/**
 * Who a department question is better put to than the department. The ask
 * flow (PPASK) uses this to route; absent means the building department.
 */
export const ASK_ROUTE_HINTS: Readonly<Record<string, Party>> = Object.freeze({
  'nyc.job_type_q': 'design_pro',
});
