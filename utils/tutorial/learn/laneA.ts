// utils/tutorial/learn/laneA.ts — tutorial fragment for lane A.
// OWNER: LEARNDEFS-A (estimate-first, change-order-draft, field-ticket-log).
//
// THE FRAGMENT SEAM (see the header of utils/tutorial/types.ts). Four content
// lanes add tutorials in parallel without touching the shared engine files:
// each one fills ONLY its own fragment, its own def files and its own screens.
//   types.ts     StaticTargetId / AssistId union in LaneATargetId / LaneAAssistId,
//                and SignalPayloadMap extends LaneASignalPayloadMap;
//   registry.ts  TARGETS / SIGNALS / ASSISTS spread LANE_A_* after the core;
//   defs/index   TUTORIAL_DEF_LIST appends ...LANE_A_DEFS;
//   validator    FULL_PAYLOADS spreads LANE_A_FULL_PAYLOADS (every signal
//                needs one) and fails an id declared twice across fragments.
// Keep the export names exactly as they are (the engine imports them).
//
// Pure data. Only `import type` from '../registry' and '../types': registry.ts
// imports THIS file at runtime, so a runtime import back would be a cycle
// (scripts/validate-tutorial-defs.ts refuses one). Def files a lane imports
// here may import '../types' as types only, plus fixtures / stats.
//
// THE SCREENS (each wraps its targets ONLY while a run is live on that very
// project, so a real job — and every phone golden — renders byte-identical):
//   app/estimate-wizard.tsx  layer estimateWizard (the wizard is a modal route,
//                            so <TutorialLayer host="estimateWizard"/> is
//                            mounted inside it). On a sample during a run the
//                            wizard never calls the AI: the sample scope
//                            prices from fixturesA, anything typed is refused.
//   app/change-order.tsx     root layer; the practice pass opens a NEW change
//                            order (or one of the sample's own) on the sample.
//   app/field-ticket.tsx     root layer; same pass rule for tickets. Signing
//                            is a legal act and is never lit, queued or practised.
// Money in every payload is integer cents (totalCents).

import type { AssistSpec, SignalSpec, TargetSpec } from '../registry';
import type { PayloadRecord, TutorialDef } from '../types';
import { estimateFirst } from '../defs/estimateFirst';
import { changeOrderDraft } from '../defs/changeOrderDraft';
import { fieldTicketLog } from '../defs/fieldTicketLog';

/** Static target ids this lane's screens wrap in <TutorialTarget id=…>. */
export type LaneATargetId =
  // app/estimate-wizard.tsx (layer estimateWizard)
  | 'estimate.scope'
  | 'estimate.generate'
  | 'estimate.summary'
  | 'estimate.save'
  | 'estimate.openJob'
  | 'estimate.modalUp'
  // app/change-order.tsx
  | 'co.description'
  | 'co.addItem'
  | 'co.scheduleImpact'
  | 'co.saveDraft'
  | 'co.modalUp'
  // app/field-ticket.tsx
  | 'ticket.work'
  | 'ticket.reason'
  | 'ticket.price'
  | 'ticket.saveUnsigned'
  | 'ticket.convert'
  | 'ticket.back'
  | 'ticket.modalUp';

/** Assist ids this lane's screens register with useTutorialAssist. */
export type LaneAAssistId =
  | 'estimate.useSampleScope'
  | 'co.useSampleChange'
  | 'co.fillSampleLine'
  | 'ticket.useSampleWork'
  | 'ticket.useSampleReason';

/** Signal payloads (WITHOUT projectId) this lane's screens emit. */
export interface LaneASignalPayloadMap {
  /** Debounced 600 ms once the scope answer reaches 4 chars on the sample
   *  run. `sample`: it is the bundled sentence (only that one prices there). */
  'estimate.scope.filled': { chars?: number; sample?: boolean };
  /** The wizard's result is on screen. On a sample run it is always the
   *  bundled one (source 'sample'); totalCents is the PRICED total at the
   *  markup in force (markupPct null = he has not set one: it is his cost). */
  'estimate.generated': { lines: number; totalCents: number; source: 'sample'; markupPct?: number | null };
  /** The sample save: the estimate written to the sample job as a new
   *  revision (updateProject), the seeded current estimate untouched. */
  'estimate.saved': { lineCount: number; totalCents?: number; markupPct?: number | null; offline?: boolean };
  /** Debounced 600 ms once the description reaches 3 chars. */
  'co.description.filled': { chars?: number };
  /** A priced line went onto the change order (the user's own Add tap).
   *  totalCents is the change order's line total after it. */
  'co.line.added': { totalCents: number; lines?: number };
  /** handleSave after persistCO wrote the change order locally. `number` is
   *  provisional until the server confirms it (#141), so no copy prints it. */
  'co.saved': { coId: string; number: number; totalCents: number; status: string; days?: number; offline?: boolean };
  /** Debounced 600 ms once the work line reaches 3 chars. */
  'ticket.work.filled': { chars?: number };
  /** Debounced 600 ms once the reason reaches 3 chars (a chip fills it). */
  'ticket.reason.filled': { chars?: number };
  /** handleSaveUnsigned after addFieldTicket. Always signed:false — a
   *  signature is never part of a tutorial. */
  'ticket.saved': { ticketId: string; number?: number; signed: boolean; offline?: boolean };
}

const EW = 'app/estimate-wizard.tsx';
const CO = 'app/change-order.tsx';
const FT = 'app/field-ticket.tsx';

export const LANE_A_TARGETS: Record<LaneATargetId, TargetSpec> = {
  'estimate.scope': { file: EW, layer: 'estimateWizard', note: "the scope question (ScopeQuestionStepper on the 'scope' step)" },
  'estimate.generate': { file: EW, layer: 'estimateWizard', note: 'wizard-generate (the footer primary on the scope step during a sample run)' },
  'estimate.summary': { file: EW, layer: 'estimateWizard', note: 'the result hero card: the priced total' },
  'estimate.save': { file: EW, layer: 'estimateWizard', note: "wizard-save-sample — 'Save to the sample job' (a fixture result only)" },
  'estimate.openJob': { file: EW, layer: 'estimateWizard', note: "wizard-open-sample-job — after the sample save, back to the job's hub" },
  'estimate.modalUp': { file: EW, layer: 'estimateWizard', blocker: true, note: 'any of: save sheet, markup sheet, the ask sheet, UpgradeSheet, the loading overlay' },

  'co.description': { file: CO, layer: 'root', note: 'co-description-input' },
  'co.addItem': { file: CO, layer: 'root', note: "add-co-item-btn ('Custom' — opens the add-line sheet)" },
  'co.scheduleImpact': { file: CO, layer: 'root', note: 'co-schedule-impact-input with its label and helper' },
  'co.saveDraft': { file: CO, layer: 'root', note: "save-co-draft ('Save to Project') — never send-co-btn" },
  'co.modalUp': { file: CO, layer: 'root', blocker: true, note: 'any of: add line, estimate lines, materials, send sheet, contact picker, approve / reflow / place sheets' },

  'ticket.work': { file: FT, layer: 'root', note: 'ticket-work' },
  'ticket.reason': { file: FT, layer: 'root', note: 'the reason chips plus ticket-reason' },
  'ticket.price': { file: FT, layer: 'root', note: 'the Overhead & profit row (ticket-markup); rates come after the signature' },
  'ticket.saveUnsigned': { file: FT, layer: 'root', note: "ticket-save-unsigned ('Save') — never ticket-get-signature / ticket-sign" },
  'ticket.convert': { file: FT, layer: 'root', note: "ticket-convert on the saved ticket's detail ('Can't bill yet' while unsigned)" },
  'ticket.back': { file: FT, layer: 'root', note: "the ToolHeader (its chevron is the screen's back to the job)" },
  'ticket.modalUp': { file: FT, layer: 'root', blocker: true, note: 'any of: SignatureModal, PricingModal' },
};

export const LANE_A_SIGNALS: { [N in keyof LaneASignalPayloadMap]: SignalSpec<N> } = {
  'estimate.scope.filled': { file: EW, payloadKeys: ['chars', 'sample'], outbound: false },
  'estimate.generated': { file: EW, payloadKeys: ['lines', 'totalCents', 'source', 'markupPct'], outbound: false },
  'estimate.saved': { file: EW, payloadKeys: ['lineCount', 'totalCents', 'markupPct', 'offline'], outbound: false },
  'co.description.filled': { file: CO, payloadKeys: ['chars'], outbound: false },
  'co.line.added': { file: CO, payloadKeys: ['totalCents', 'lines'], outbound: false },
  'co.saved': { file: CO, payloadKeys: ['coId', 'number', 'totalCents', 'status', 'days', 'offline'], outbound: false },
  'ticket.work.filled': { file: FT, payloadKeys: ['chars'], outbound: false },
  'ticket.reason.filled': { file: FT, payloadKeys: ['chars'], outbound: false },
  'ticket.saved': { file: FT, payloadKeys: ['ticketId', 'number', 'signed', 'offline'], outbound: false },
};

export const LANE_A_ASSISTS: Record<LaneAAssistId, AssistSpec> = {
  'estimate.useSampleScope': { file: EW, what: 'fills SAMPLE_SCOPE into the scope answer (sample run only) — never presses Generate' },
  'co.useSampleChange': { file: CO, what: "fills CO_SAMPLE.description (and 'Client request' when the reason is empty), sample only" },
  'co.fillSampleLine': { file: CO, what: 'opens the add-line sheet prefilled with CO_SAMPLE.line — the user taps Add' },
  'ticket.useSampleWork': { file: FT, what: 'fills TICKET_SAMPLE.work and one labor row (Electrician, 3 hr) when none has hours, sample only' },
  'ticket.useSampleReason': { file: FT, what: "picks the 'Owner / rep directive' reason chip, sample only" },
};

/** Long-but-plausible payloads for every signal above: the defs validator
 *  renders every copy slot with these (and with none) to prove it fits. */
export const LANE_A_FULL_PAYLOADS: PayloadRecord = {
  'estimate.scope.filled': { projectId: 's', chars: 480, sample: false },
  'estimate.generated': { projectId: 's', lines: 48, totalCents: 123_456_789, source: 'sample', markupPct: 27.5 },
  'estimate.saved': { projectId: 's', lineCount: 48, totalCents: 123_456_789, markupPct: 27.5, offline: false },
  'co.description.filled': { projectId: 's', chars: 240 },
  'co.line.added': { projectId: 's', totalCents: 123_456_789, lines: 12 },
  'co.saved': { projectId: 's', coId: 'c', number: 1234, totalCents: 123_456_789, status: 'draft', days: 120, offline: false },
  'ticket.work.filled': { projectId: 's', chars: 200 },
  'ticket.reason.filled': { projectId: 's', chars: 60 },
  'ticket.saved': { projectId: 's', ticketId: 't', number: 1234, signed: false, offline: false },
};

/** This lane's tutorial defs, in the order they join TUTORIAL_DEF_LIST. */
export const LANE_A_DEFS: readonly TutorialDef[] = [estimateFirst, changeOrderDraft, fieldTicketLog];
