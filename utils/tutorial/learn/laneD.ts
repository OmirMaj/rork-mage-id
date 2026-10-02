// utils/tutorial/learn/laneD.ts — tutorial fragment for lane D.
// OWNER: LEARNDEFS-D (contract-from-estimate, pay-app-period, closeout-binder).
//
// THE FRAGMENT SEAM (see the header of utils/tutorial/types.ts). Four content
// lanes add tutorials in parallel without touching the shared engine files:
// each one fills ONLY its own fragment, its own def files and its own screens.
//   types.ts     StaticTargetId / AssistId union in LaneDTargetId / LaneDAssistId,
//                and SignalPayloadMap extends LaneDSignalPayloadMap;
//   registry.ts  TARGETS / SIGNALS / ASSISTS spread LANE_D_* after the core;
//   defs/index   TUTORIAL_DEF_LIST appends ...LANE_D_DEFS;
//   validator    FULL_PAYLOADS spreads LANE_D_FULL_PAYLOADS (every signal
//                needs one) and fails an id declared twice across fragments.
// Keep the export names exactly as they are (the engine imports them).
//
// Pure data. Only `import type` from '../registry' and '../types': registry.ts
// imports THIS file at runtime, so a runtime import back would be a cycle
// (scripts/validate-tutorial-defs.ts refuses one). Def files a lane imports
// here may import '../types' as types only, plus fixtures / stats.
//
// LEGAL AND MONEY DOCUMENTS. These three tutorials teach the SET-UP. Signing,
// sealing, certifying, delivering and sending are only ever LOOK steps that
// say so (scripts/validate-tutorial-learn-d.ts refuses a do / wait step on any
// of them), and every signal below is a local or online save the user made,
// never an outbound act (outbound: false, which the defs validator enforces
// for any `until`).
//
// THE SCREENS (each wraps its targets ONLY while a run is live on that very
// project, so a real job — and every phone golden — renders byte-identical):
//   app/contract.tsx         root layer. On a sample Sign & send, Sign together
//                            and every delivery refuse with SAMPLE_DOC_NOT_SENT,
//                            run or no run.
//   app/aia-pay-app.tsx      root layer. On a sample no pay link is minted (the
//                            three createPaymentLink call sites refuse first).
//   app/closeout-binder.tsx  root layer. On a sample Deliver / Re-deliver refuse.
// Money in every payload is integer cents.

import type { AssistSpec, SignalSpec, TargetSpec } from '../registry';
import type { PayloadRecord, TutorialDef } from '../types';
import type { ContractTermsSource } from './fixturesD';
import { contractFromEstimate } from '../defs/contractFromEstimate';
import { payAppPeriod } from '../defs/payAppPeriod';
import { closeoutBinder } from '../defs/closeoutBinder';

/** Static target ids this lane's screens wrap in <TutorialTarget id=…>. */
export type LaneDTargetId =
  // app/contract.tsx
  | 'contract.sum'
  | 'contract.timeline'
  | 'contract.reviewNotice'
  | 'contract.warranty'
  | 'contract.paymentTerms'
  | 'contract.saveDraft'
  | 'contract.sign'
  | 'contract.back'
  | 'contract.modalUp'
  // app/aia-pay-app.tsx
  | 'payApp.pickPeriod'
  | 'payApp.editDraft'
  | 'payApp.periodTo'
  | 'payApp.g703'
  | 'payApp.lineProgress'
  | 'payApp.saveDraft'
  | 'payApp.certifyExplain'
  | 'payApp.back'
  | 'payApp.modalUp'
  // app/closeout-binder.tsx
  | 'binder.sections'
  | 'binder.saveDraft'
  | 'binder.deliver'
  | 'binder.finalize'
  | 'binder.back'
  | 'binder.modalUp';

/** Assist ids this lane's screens register with useTutorialAssist. */
export type LaneDAssistId = 'payApp.usePeriodToday';

/** Signal payloads (WITHOUT projectId) this lane's screens emit. */
export interface LaneDSignalPayloadMap {
  /** The draft on screen carries BOTH halves of the timeline (fixturesD
   *  contractTimelinePayload), debounced 600 ms. Not a save: no stamp. */
  'contract.timeline.set': { startDate: string; durationDays: number };
  /** saveDraftFrom wrote the draft (saveContractDetailed ok) with a payment
   *  schedule on it. startDate / durationDays are the SAVED row's; warrantySet
   *  is false while the warranty paragraph is still the placeholder. */
  'contract.terms.set': { source: ContractTermsSource; warrantySet: boolean; startDate?: string; durationDays?: number };
  /** PERIOD TO became a real day other than the one the screen opened with
   *  (fixturesD payAppPeriodPayload), debounced 600 ms. Not a save. */
  'payApp.period.set': { periodTo: string };
  /** A line he changed (updateLine / applyPercentToLine — the card, the %
   *  chips and the desktop grid all write through them) bills this period
   *  (fixturesD payAppLinePayload), debounced 600 ms. Not a save. */
  'payApp.line.set': { lineId: string; thisPeriodCents: number };
  /** handleSave after addAIAPayApp — the plain, NON-certifying save. */
  'payApp.saved': { applicationNumber: number; currentDueCents: number; offline?: boolean };
  /** handleSave after persistBinder resolved with a row (an online write). */
  'binder.saved': { sections: number; status: 'draft' };
}

const CT = 'app/contract.tsx';
const PA = 'app/aia-pay-app.tsx';
const BD = 'app/closeout-binder.tsx';

export const LANE_D_TARGETS: Record<LaneDTargetId, TargetSpec> = {
  'contract.sum': { file: CT, layer: 'root', note: 'the Contract title + Contract value card (the sum the estimate seeded)' },
  'contract.timeline': { file: CT, layer: 'root', note: 'the Timeline card: contract-start-date, contract-duration-days, contract-timeline-suggest' },
  'contract.reviewNotice': { file: CT, layer: 'root', note: 'contract-review-before-signing (shown only after a Sign press filled missing terms)' },
  'contract.warranty': { file: CT, layer: 'root', note: 'the Warranty card (contract-set-warranty lives inside it)' },
  'contract.paymentTerms': { file: CT, layer: 'root', note: 'contract-terms-not-set with contract-set-payment-terms (an empty schedule only)' },
  'contract.saveDraft': { file: CT, layer: 'root', note: "the action bar's Save draft (handleSaveDraft → saveDraftFrom) — never Sign & send" },
  'contract.sign': { file: CT, layer: 'root', note: 'Sign & send — LOOK ONLY, never a do step; refused on a sample' },
  'contract.back': { file: CT, layer: 'root', note: "the header's back chevron (router.back to the job's hub)" },
  'contract.modalUp': { file: CT, layer: 'root', blocker: true, note: 'any of: terms ask sheet, signature sheet, record-signature modal, delivery ask, start-date picker' },

  'payApp.pickPeriod': { file: PA, layer: 'root', note: "the billing-period chooser's invoice rows (aia-pick-invoice-*)" },
  'payApp.editDraft': { file: PA, layer: 'root', note: 'aia-edit-draft — a SAVED period opens read-only (review mode); Edit draft reopens it' },
  'payApp.periodTo': { file: PA, layer: 'root', note: 'aia-period-to with its label' },
  'payApp.g703': { file: PA, layer: 'root', note: 'the Schedule of values (G703) section — cards on phone, aia-g703 grid on desktop web' },
  'payApp.lineProgress': { file: PA, layer: 'root', note: 'the first SOV card: its This period field and % chips (cards view only)' },
  'payApp.saveDraft': { file: PA, layer: 'root', note: "the bottom bar's Save to project (handleSave) — never Generate PDF / the certify slide" },
  'payApp.certifyExplain': { file: PA, layer: 'root', note: "the Architect's certificate section — LOOK ONLY, never aia-save-certification" },
  'payApp.back': { file: PA, layer: 'root', note: "the stack header's back chevron (headerLeft)" },
  'payApp.modalUp': { file: PA, layer: 'root', blocker: true, note: 'any of: the first-use legal note, Ready to certify?' },

  'binder.sections': { file: BD, layer: 'root', note: 'the Auto-compiled preview card (its PreviewRow labels are the sections)' },
  'binder.saveDraft': { file: BD, layer: 'root', note: 'binder-save-draft (handleSave)' },
  'binder.deliver': { file: BD, layer: 'root', note: 'binder-deliver (finalized only) — LOOK ONLY; refused on a sample' },
  'binder.finalize': { file: BD, layer: 'root', note: 'binder-finalize, the finalize slide (draft only) — LOOK ONLY' },
  'binder.back': { file: BD, layer: 'root', note: "the header's back chevron" },
  'binder.modalUp': { file: BD, layer: 'root', blocker: true, note: 'the AIA-styled form modal' },
};

export const LANE_D_SIGNALS: { [N in keyof LaneDSignalPayloadMap]: SignalSpec<N> } = {
  'contract.timeline.set': { file: CT, payloadKeys: ['startDate', 'durationDays'], outbound: false },
  'contract.terms.set': { file: CT, payloadKeys: ['source', 'warrantySet', 'startDate', 'durationDays'], outbound: false },
  'payApp.period.set': { file: PA, payloadKeys: ['periodTo'], outbound: false },
  'payApp.line.set': { file: PA, payloadKeys: ['lineId', 'thisPeriodCents'], outbound: false },
  'payApp.saved': { file: PA, payloadKeys: ['applicationNumber', 'currentDueCents', 'offline'], outbound: false },
  'binder.saved': { file: BD, payloadKeys: ['sections', 'status'], outbound: false },
};

export const LANE_D_ASSISTS: Record<LaneDAssistId, AssistSpec> = {
  'payApp.usePeriodToday': { file: PA, what: "PERIOD TO = today through the screen's own setPeriodTo (sample only) — never presses Save" },
};

/** Long-but-plausible payloads for every signal above: the defs validator
 *  renders every copy slot with these (and with none) to prove it fits. */
export const LANE_D_FULL_PAYLOADS: PayloadRecord = {
  'contract.timeline.set': { projectId: 's', startDate: '2026-12-28', durationDays: 1460 },
  'contract.terms.set': { projectId: 's', source: 'profile', warrantySet: false, startDate: '2026-12-28', durationDays: 1460 },
  'payApp.period.set': { projectId: 's', periodTo: '2026-12-31' },
  'payApp.line.set': { projectId: 's', lineId: 'l', thisPeriodCents: 123_456_789 },
  'payApp.saved': { projectId: 's', applicationNumber: 1234, currentDueCents: 123_456_789, offline: false },
  'binder.saved': { projectId: 's', sections: 3, status: 'draft' },
};

/** This lane's tutorial defs, in the order they join TUTORIAL_DEF_LIST. */
export const LANE_D_DEFS: readonly TutorialDef[] = [contractFromEstimate, payAppPeriod, closeoutBinder];
