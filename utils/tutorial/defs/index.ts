// defs/index.ts — every tutorial this build ships, in hub order.
// Wave A: daily report by voice, punch walk, invoice to self. Later waves add
// schedule-say-it (A2), client-portal-preview (B) and first-bid-coach (C) by
// adding a def file here — the engine and types already know their ids.
//
// LEARN wave (2026-10-01): the twelve new tutorials arrive through the four
// lane fragments (utils/tutorial/learn/lane{A,B,C,D}.ts — see the header of
// ../types.ts). A content lane adds its defs to its own LANE_X_DEFS; this file
// is not edited. The list order is not the hub order: TUTORIAL_ORDER is.

import type { TutorialDef, TutorialDefs, TutorialId } from '../types';
import { LANE_A_DEFS } from '../learn/laneA';
import { LANE_B_DEFS } from '../learn/laneB';
import { LANE_C_DEFS } from '../learn/laneC';
import { LANE_D_DEFS } from '../learn/laneD';
import { dailyReportVoice } from './dailyReportVoice';
import { punchWalk } from './punchWalk';
import { invoiceToSelf } from './invoiceToSelf';

export const TUTORIAL_DEF_LIST: readonly TutorialDef[] = [
  dailyReportVoice,
  punchWalk,
  invoiceToSelf,
  ...LANE_A_DEFS,
  ...LANE_B_DEFS,
  ...LANE_C_DEFS,
  ...LANE_D_DEFS,
];

export const TUTORIAL_DEFS: TutorialDefs = Object.freeze(
  Object.fromEntries(TUTORIAL_DEF_LIST.map(d => [d.id, d])) as Partial<Record<TutorialId, TutorialDef>>,
);

/** Hub order (and the order tutorialsForUser returns). The LEARN wave's
 *  twelve fold into the existing hub groups (no new TutorialGroup): bid,
 *  money, site, then client (schedule-say-it is already listed above). An id
 *  with no def yet is simply not shown. */
export const TUTORIAL_ORDER: readonly TutorialId[] = [
  'daily-report-voice',
  'punch-walk',
  'invoice-to-self',
  'schedule-say-it',
  'client-portal-preview',
  'first-bid-coach',
  // bid
  'estimate-first',
  'takeoff-to-estimate',
  'construction-ai-ask',
  // money
  'change-order-draft',
  'pay-app-period',
  // site
  'field-ticket-log',
  'time-clock-in',
  'punch-list-close',
  'ask-your-plans',
  // client
  'contract-from-estimate',
  'closeout-binder',
];

/** The sample project each sandbox kind lives on (utils/demoSeed names). */
export const SANDBOX_PROJECT_NAME = {
  'sarahs-place': "Sample — Sarah's Place",
  'residential-build': 'Sample — Residential Build',
} as const;

export { dailyReportVoice, punchWalk, invoiceToSelf };
