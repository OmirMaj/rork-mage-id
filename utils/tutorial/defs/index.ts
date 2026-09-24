// defs/index.ts — every tutorial this build ships, in hub order.
// Wave A: daily report by voice, punch walk, invoice to self. Later waves add
// schedule-say-it (A2), client-portal-preview (B) and first-bid-coach (C) by
// adding a def file here — the engine and types already know their ids.

import type { TutorialDef, TutorialDefs, TutorialId } from '../types';
import { dailyReportVoice } from './dailyReportVoice';
import { punchWalk } from './punchWalk';
import { invoiceToSelf } from './invoiceToSelf';

export const TUTORIAL_DEF_LIST: readonly TutorialDef[] = [dailyReportVoice, punchWalk, invoiceToSelf];

export const TUTORIAL_DEFS: TutorialDefs = Object.freeze(
  Object.fromEntries(TUTORIAL_DEF_LIST.map(d => [d.id, d])) as Partial<Record<TutorialId, TutorialDef>>,
);

/** Hub order (and the order tutorialsForUser returns). */
export const TUTORIAL_ORDER: readonly TutorialId[] = [
  'daily-report-voice',
  'punch-walk',
  'invoice-to-self',
  'schedule-say-it',
  'client-portal-preview',
  'first-bid-coach',
];

/** The sample project each sandbox kind lives on (utils/demoSeed names). */
export const SANDBOX_PROJECT_NAME = {
  'sarahs-place': "Sample — Sarah's Place",
  'residential-build': 'Sample — Residential Build',
} as const;

export { dailyReportVoice, punchWalk, invoiceToSelf };
