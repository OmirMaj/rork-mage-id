// utils/tutorial/learn/laneB.ts — tutorial fragment for lane B.
// OWNER: LEARNDEFS-B (takeoff-to-estimate, ask-your-plans, construction-ai-ask).
//
// THE FRAGMENT SEAM (see the header of utils/tutorial/types.ts). Four content
// lanes add tutorials in parallel without touching the shared engine files:
// each one fills ONLY its own fragment, its own def files and its own screens.
//   types.ts     StaticTargetId / AssistId union in LaneBTargetId / LaneBAssistId,
//                and SignalPayloadMap extends LaneBSignalPayloadMap;
//   registry.ts  TARGETS / SIGNALS / ASSISTS spread LANE_B_* after the core;
//   defs/index   TUTORIAL_DEF_LIST appends ...LANE_B_DEFS;
//   validator    FULL_PAYLOADS spreads LANE_B_FULL_PAYLOADS (every signal
//                needs one) and fails an id declared twice across fragments.
// Keep the export names exactly as they are (the engine imports them).
//
// Pure data. Only `import type` from '../registry' and '../types': registry.ts
// imports THIS file at runtime, so a runtime import back would be a cycle
// (scripts/validate-tutorial-defs.ts refuses one). Def files a lane imports
// here may import '../types' as types only, plus fixtures / stats.
//
// LANE B's THREE SCREENS ARE AI SCREENS. Every step that would normally spend
// an AI call takes a bundled answer on the sample (./fixturesB), and every AI
// entry point on those screens is behind the tutorial lock while a run is
// live on the sample — scripts/validate-tutorial-learn-b.ts reads the screens
// and fails the build if one is not.
//
// GOLDEN-NEUTRAL WRAPPING. Each screen renders its <TutorialTarget> wrappers
// ONLY while a run is live on that job (the wrapper is a real View, and the
// phone goldens hash the whole tree), so a screen with no tutorial renders
// exactly what it did before.

import type { AssistSpec, SignalSpec, TargetSpec } from '../registry';
import type { PayloadRecord, TutorialDef } from '../types';
import { takeoffToEstimate } from '../defs/takeoffToEstimate';
import { askYourPlans } from '../defs/askYourPlans';
import { constructionAiAsk } from '../defs/constructionAiAsk';

/** Static target ids this lane's screens wrap in <TutorialTarget id=…>. */
export type LaneBTargetId =
  // app/takeoff.tsx
  | 'takeoff.useSample'
  | 'takeoff.results'
  | 'takeoff.convert'
  | 'takeoff.modalUp'
  // app/plans.tsx
  | 'plans.askCta'
  | 'plans.modalUp'
  // components/plans/AskPlansPanel.tsx (layer askPlans)
  | 'askPlans.input'
  | 'askPlans.sampleQuestion'
  | 'askPlans.citation'
  | 'askPlans.openCitation'
  // app/(tabs)/construction-ai/index.tsx
  | 'cai.modeAsk'
  | 'cai.modalUp'
  // components/construction/AskConstructionMode.tsx
  | 'cai.askInput'
  | 'cai.run'
  | 'cai.consulted'
  | 'cai.honesty'
  | 'cai.askModalUp';

/** Assist ids this lane's screens register with useTutorialAssist. */
export type LaneBAssistId = 'takeoff.useSamplePlan' | 'askPlans.useSampleQuestion' | 'cai.useSampleQuestion';

/** Signal payloads (WITHOUT projectId) this lane's screens emit. */
export interface LaneBSignalPayloadMap {
  /** takeoff: the bundled A-101 result is on screen (chip or Do it for me).
   *  `items` = counted lines. Only the fixture path emits it. */
  'takeoff.result.ready': { items: number; source: 'sample' };
  /** takeoff: the lines were written to the sample's estimate (after the
   *  updateProject call). Money in integer cents. */
  'takeoff.converted': { lineCount: number; pricedCount?: number; totalCents?: number };
  /** Ask your plans: the bundled, cited answer is on screen. */
  'askPlans.answered': { citations: number; source: 'sample' };
  /** Ask your plans: a citation chip opened its sheet (right before the push). */
  'askPlans.sheet.opened': { sheetNumber?: string };
  /** Construction AI: the box holds the sample question (typed or filled). */
  'cai.question.filled': { chars?: number };
  /** Construction AI: the sample answer is on screen. `consulted` = records
   *  read (sources + also checked); `leftCents` = the answer's number. */
  'cai.answered': { source: 'sample'; consulted: number; leftCents?: number };
}

const TAKEOFF = 'app/takeoff.tsx';
const PLANS = 'app/plans.tsx';
const PANEL = 'components/plans/AskPlansPanel.tsx';
const CAI = 'app/(tabs)/construction-ai/index.tsx';
const ASK = 'components/construction/AskConstructionMode.tsx';

export const LANE_B_TARGETS: Record<LaneBTargetId, TargetSpec> = {
  'takeoff.useSample': { file: TAKEOFF, layer: 'root', note: 'takeoff-upload-card plus the Use the sample plan chip, one hole over both' },
  'takeoff.results': { file: TAKEOFF, layer: 'root', note: 'the sample lines card: count, room, sheet and his own price (or No price yet)' },
  'takeoff.convert': { file: TAKEOFF, layer: 'root', note: 'takeoff-convert-cta' },
  'takeoff.modalUp': { file: TAKEOFF, layer: 'root', blocker: true, note: 'any of: page inspector, buyout preview, UpgradeSheet' },

  'plans.askCta': { file: PLANS, layer: 'root', note: 'plans-ask-cta (opens the Ask sheet, which hosts the askPlans layer)' },
  'plans.modalUp': { file: PLANS, layer: 'root', blocker: true, note: 'any of: plan sweep, new sheet, title-block numbers (NOT the Ask sheet — it has the askPlans layer)' },

  'askPlans.input': { file: PANEL, layer: 'askPlans', note: 'the question row — its mount completes the open-the-box step' },
  'askPlans.sampleQuestion': { file: PANEL, layer: 'askPlans', note: 'the sample-question chip plus the question row' },
  'askPlans.citation': { file: PANEL, layer: 'askPlans', note: 'the answer card with its citation chips' },
  'askPlans.openCitation': { file: PANEL, layer: 'askPlans', note: 'the first live citation chip (Sheet A-101)' },

  'cai.modeAsk': { file: CAI, layer: 'root', note: 'the four-mode toggle bar (mode-toggle-ask lit)' },
  'cai.modalUp': { file: CAI, layer: 'root', blocker: true, note: 'any of: inspection sheet, inspection result sheet, code result sheet, loaders' },

  'cai.askInput': { file: ASK, layer: 'root', note: 'construction-ask-input plus the sample-question chip' },
  'cai.run': { file: ASK, layer: 'root', note: 'construction-ask-run' },
  'cai.consulted': { file: ASK, layer: 'root', note: 'Sources plus Also checked (construction-ask-consulted)' },
  'cai.honesty': { file: ASK, layer: 'root', note: 'construction-ask-ahj, the honesty banner' },
  'cai.askModalUp': { file: ASK, layer: 'root', blocker: true, note: "Ask mode's Paywall sheet" },
};

export const LANE_B_SIGNALS: { [N in keyof LaneBSignalPayloadMap]: SignalSpec<N> } = {
  'takeoff.result.ready': { file: TAKEOFF, payloadKeys: ['items', 'source'], outbound: false },
  'takeoff.converted': { file: TAKEOFF, payloadKeys: ['lineCount', 'pricedCount', 'totalCents'], outbound: false },
  'askPlans.answered': { file: PANEL, payloadKeys: ['citations', 'source'], outbound: false },
  'askPlans.sheet.opened': { file: PANEL, payloadKeys: ['sheetNumber'], outbound: false },
  'cai.question.filled': { file: ASK, payloadKeys: ['chars'], outbound: false },
  'cai.answered': { file: ASK, payloadKeys: ['source', 'consulted', 'leftCents'], outbound: false },
};

export const LANE_B_ASSISTS: Record<LaneBAssistId, AssistSpec> = {
  'takeoff.useSamplePlan': { file: TAKEOFF, what: 'shows SAMPLE_TAKEOFF_RESULT in the real review — no upload, no AI call, no meter change' },
  'askPlans.useSampleQuestion': { file: PANEL, what: 'fills SAMPLE_PLAN_QUESTION and shows samplePlanAnswer(SAMPLE_PLAN) — no search, no AI call' },
  'cai.useSampleQuestion': { file: ASK, what: "fills SAMPLE_JOB_QUESTION into the box; he still taps Get answer" },
};

/** Long-but-plausible payloads for every signal above: the defs validator
 *  renders every copy slot with these (and with none) to prove it fits. */
export const LANE_B_FULL_PAYLOADS: PayloadRecord = {
  'takeoff.result.ready': { projectId: 's', items: 1234, source: 'sample' },
  'takeoff.converted': { projectId: 's', lineCount: 1234, pricedCount: 1199, totalCents: 123_456_789 },
  'askPlans.answered': { projectId: 's', citations: 12, source: 'sample' },
  'askPlans.sheet.opened': { projectId: 's', sheetNumber: 'A-101.2B' },
  'cai.question.filled': { projectId: 's', chars: 4000 },
  'cai.answered': { projectId: 's', source: 'sample', consulted: 1234, leftCents: 123_456_789 },
};

/** This lane's tutorial defs, in the order they join TUTORIAL_DEF_LIST. */
export const LANE_B_DEFS: readonly TutorialDef[] = [takeoffToEstimate, askYourPlans, constructionAiAsk];
