// utils/tutorial/registry.ts — where every id a tutorial depends on lives in
// the source tree.
//
// WHY. A tutorial is a promise that a specific real control exists on a
// specific screen and that the screen fires a specific success signal. Those
// promises rot silently: someone renames a button, the coach card points at
// nothing, and the user is stranded on step 3. So every id is declared here
// WITH the file it must appear in, and scripts/validate-tutorial-defs.ts
// reads those files and fails the build when the wrapper, the signal call,
// the assist hook or the modal layer is missing. Documents lie; code doesn't.
//
// Pure data. No react / react-native imports.

import type { AssistId, LayerId, SignalName, SignalPayloadMap, StaticTargetId } from './types';

export interface TargetSpec {
  /** Repo-relative file that must contain <TutorialTarget id="…">. */
  file: string;
  layer: LayerId;
  note: string;
  /** A blocker sentinel: rendered (childless) while a layer-less modal is up
   *  on that screen. Never a step target or goal; its mount hides the coach. */
  blocker?: true;
}

/** Every static target a wave-A def uses. Typed as a full Record so adding a
 *  StaticTargetId without registering its file is a tsc error. */
export const TARGETS: Record<StaticTargetId, TargetSpec> = {
  'dfr.voice': { file: 'app/daily-report.tsx', layer: 'root', note: 'VoiceRecorder row plus the sample-note chip, one hole over both' },
  'dfr.voicePreview': { file: 'app/daily-report.tsx', layer: 'root', note: "the 'Here's what I heard' preview card" },
  'dfr.workPerformed': { file: 'app/daily-report.tsx', layer: 'root', note: 'work-performed-input — fallback when the preview card is gone' },
  'dfr.saveDraft': { file: 'app/daily-report.tsx', layer: 'root', note: 'top-bar Save Draft (save-draft-btn)' },

  'punch.camera': { file: 'app/punch-walk.tsx', layer: 'root', note: 'walk-camera plus the Use sample photo chip' },
  'punch.description': { file: 'app/punch-walk.tsx', layer: 'root', note: 'walk-description plus the sample-line chip' },
  'punch.save': { file: 'app/punch-walk.tsx', layer: 'root', note: 'walk-save' },
  'punch.sessionCount': { file: 'app/punch-walk.tsx', layer: 'root', note: 'walk-header session count chip (appears on the first save)' },
  'punch.back': { file: 'app/punch-walk.tsx', layer: 'root', note: 'header back chevron (accessibilityLabel Back)' },

  'punch.planImage': { file: 'components/punch/PlanPinStep.tsx', layer: 'planPin', note: 'the plan image responder box inside walk-pin-canvas' },
  'punch.pinMarker': { file: 'components/punch/PlanPinStep.tsx', layer: 'planPin', note: 'walk-pin-marker — its mount completes the drop-pin step' },
  'punch.pinNext': { file: 'components/punch/PlanPinStep.tsx', layer: 'planPin', note: 'walk-pin-next' },

  'invoice.percent': { file: 'app/invoice.tsx', layer: 'root', note: 'progress-percent-input' },
  'invoice.totals': { file: 'app/invoice.tsx', layer: 'root', note: 'totalsCard' },
  'invoice.send': { file: 'app/invoice.tsx', layer: 'root', note: "send-invoice-btn (reads 'Send to me' on a sample)" },

  // Blocker sentinels — one per screen, mounted while ANY of that screen's
  // layer-less RN Modals is visible. Why one per screen and not one per step:
  // the modals a user can open mid-step are not the step's to choose (the
  // invoice retainage ask opens by itself on mount; the contact picker is one
  // tap from the send sheet; the sub picker is one tap from Save), so a
  // per-step list would always be one modal short. PlanPinStep is NOT counted:
  // it hosts its own tutorial layer.
  'dfr.modalUp': { file: 'app/daily-report.tsx', layer: 'root', blocker: true, note: 'any of: send sheet, task picker, manpower, delay-task picker, date / contact picker, UpgradeSheet' },
  'voice.modalUp': { file: 'components/VoiceRecorder.tsx', layer: 'root', blocker: true, note: 'VoiceCaptureModal open (modalOpen) — its pageSheet covers the dfr-voice spotlight on iPhone' },
  'punch.modalUp': { file: 'app/punch-walk.tsx', layer: 'root', blocker: true, note: 'any of: trade override, sub picker, all locations (NOT PlanPinStep — it has the planPin layer)' },
  'invoice.modalUp': { file: 'app/invoice.tsx', layer: 'root', blocker: true, note: 'any of: send sheet, retainage ask, retention, payment, date / contact picker, PDF pre-send' },
  'hub.modalUp': { file: 'app/project-detail.tsx', layer: 'root', blocker: true, note: 'any section / action modal on the project hub' },
};

/** The blocker sentinel ids (see TargetSpec.blocker). */
export const BLOCKER_TARGETS: readonly StaticTargetId[] = (Object.keys(TARGETS) as StaticTargetId[]).filter(id => TARGETS[id].blocker === true);

export function isBlockerTarget(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(TARGETS, id) && TARGETS[id as StaticTargetId].blocker === true;
}

/** Id prefixes a screen generates from data. The source scan accepts either a
 *  static id="hub.tile.x" or the template literal `hub.tile.${…}` in the file. */
export const DYNAMIC_TARGET_FAMILIES: Record<'hub.tile.' | 'hub.group.', { file: string; layer: LayerId; note: string }> = {
  'hub.tile.': { file: 'app/project-detail.tsx', layer: 'root', note: 'renderTile: id={`hub.tile.${tile.key}`}' },
  'hub.group.': { file: 'app/project-detail.tsx', layer: 'root', note: 'group header: id={`hub.group.${group.key}`}' },
};

export interface SignalSpec<N extends SignalName = SignalName> {
  /** Repo-relative file that must contain tutorialSignal('name', …). */
  file: string;
  /** Payload keys besides projectId (documentation + validator cross-check). */
  payloadKeys: readonly (keyof SignalPayloadMap[N])[];
  /** True if the action reaches someone other than the user. A tutorial may
   *  never wait on an outbound signal (the validator refuses it). invoice.sent
   *  is false because on a sample the send is locked to the user's own email
   *  (utils/sampleGuard). */
  outbound: boolean;
  /** A failure report, not a success — never a step's `until`. */
  failure?: boolean;
}

export const SIGNALS: { [N in SignalName]: SignalSpec<N> } = {
  'dfr.voice.applied': { file: 'app/daily-report.tsx', payloadKeys: ['fields', 'source'], outbound: false },
  'dfr.saved': { file: 'app/daily-report.tsx', payloadKeys: ['reportId', 'status', 'date', 'crew', 'offline'], outbound: false },
  'punch.photo.added': { file: 'app/punch-walk.tsx', payloadKeys: ['source'], outbound: false },
  'punch.pin.decided': { file: 'app/punch-walk.tsx', payloadKeys: ['pinned'], outbound: false },
  'punch.description.filled': { file: 'app/punch-walk.tsx', payloadKeys: ['chars'], outbound: false },
  'punch.saved': { file: 'app/punch-walk.tsx', payloadKeys: ['itemId', 'location', 'trade', 'pinned', 'sheet', 'offline'], outbound: false },
  'invoice.amount.set': { file: 'app/invoice.tsx', payloadKeys: ['total'], outbound: false },
  'invoice.sent': { file: 'app/invoice.tsx', payloadKeys: ['invoiceId', 'number', 'total', 'to'], outbound: false },
  'invoice.send.failed': { file: 'app/invoice.tsx', payloadKeys: ['reason'], outbound: false, failure: true },
};

export interface AssistSpec {
  /** Repo-relative file that must contain useTutorialAssist('id', …). */
  file: string;
  what: string;
}

export const ASSISTS: Record<AssistId, AssistSpec> = {
  'dfr.useSampleNote': { file: 'app/daily-report.tsx', what: 'applyParsedDfr(DFR_SAMPLE_NOTE.parsed, {metered:false}) — no AI call, no meter change' },
  'punch.useSamplePhoto': { file: 'app/punch-walk.tsx', what: 'the bundled sample-outlet.jpg through the same continuation as a camera shot' },
  'punch.dropPinKitchen': { file: 'components/punch/PlanPinStep.tsx', what: 'sets the pin at SAMPLE_PLAN.rooms.Kitchen; the user still taps Next' },
  'punch.useSampleLine': { file: 'app/punch-walk.tsx', what: "fills PUNCH_SAMPLE.line, and 'Kitchen' when the room is empty" },
  'invoice.fillPercent': { file: 'app/invoice.tsx', what: 'fills 15 into progress-percent-input' },
};

export interface LayerSpec {
  /** Repo-relative file that must contain <TutorialLayer host="id"/>. */
  file: string;
  /** Drawn inside a modal (iOS draws modals above the root layer). */
  modal: boolean;
}

export const LAYERS: Record<LayerId, LayerSpec> = {
  root: { file: 'components/tutorial/TutorialHost.tsx', modal: false },
  planPin: { file: 'components/punch/PlanPinStep.tsx', modal: true },
  scheduleEdit: { file: 'components/copilot/ScheduleEditPanel.tsx', modal: true },
  estimateWizard: { file: 'app/estimate-wizard.tsx', modal: true },
};

/** Draw order when several layers are mounted: a modal layer sits above root.
 *  Only one modal layer is ever up at a time in practice; the order is a
 *  deterministic tie-break, not a claim about iOS stacking. */
export const LAYER_ORDER: readonly LayerId[] = ['root', 'planPin', 'scheduleEdit', 'estimateWizard'];

/** The one AsyncStorage key for tutorial progress. mageid_ prefix → the
 *  tenant-switch sweep (wipeLocalUserCache) clears it with no list edit. */
export const TUTORIAL_PROGRESS_KEY = 'mageid_tutorials_v1';

export function isStaticTargetId(id: string): id is StaticTargetId {
  return Object.prototype.hasOwnProperty.call(TARGETS, id);
}

/** The registry entry for any target id, static or from a dynamic family. */
export function targetSpec(id: string): { file: string; layer: LayerId; note: string } | null {
  if (isStaticTargetId(id)) return TARGETS[id];
  for (const prefix of Object.keys(DYNAMIC_TARGET_FAMILIES) as (keyof typeof DYNAMIC_TARGET_FAMILIES)[]) {
    if (id.startsWith(prefix) && id.length > prefix.length) return DYNAMIC_TARGET_FAMILIES[prefix];
  }
  return null;
}
