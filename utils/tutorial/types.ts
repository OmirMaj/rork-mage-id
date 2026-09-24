// utils/tutorial/types.ts — the public contract of the learn-by-doing
// tutorial engine. FROZEN for wave A: the host (L2), the screens (L3, L4b),
// the data lane (L4a) and the entry points (L5) all build against these
// shapes. Add to a union; never rename a member.
//
// WHY A SEPARATE TYPES FILE. The engine core (machine, placement, defs,
// registry) is pure so bun validators can run it with no React / RN in the
// import graph. Screens import these types to call tutorialSignal() and wrap
// controls in <TutorialTarget id=…>, and a type-only import keeps them from
// pulling the machine into every screen bundle chunk.
//
// Only `import type` below — this file emits no runtime code.

import type { DailyFieldReport, LinkedEstimateItem } from '@/types';
import type { FeatureKey } from '@/utils/featureTiers';

export type { FeatureKey };

// ── Identities ───────────────────────────────────────────────────────────────

/** Every tutorial the spec names. Wave A ships the first three; the rest are
 *  listed so later waves add a def file, not a type change. */
export type TutorialId =
  | 'daily-report-voice'
  | 'punch-walk'
  | 'invoice-to-self'
  | 'schedule-say-it'
  | 'client-portal-preview'
  | 'first-bid-coach';

export type StepKind = 'do' | 'look' | 'wait';

/** 'tap' loops on the hole centre; 'tap-point' travels to step.point first. */
export type Gesture = 'tap' | 'tap-point' | 'none';

/** Where a spotlight draws. 'root' is the app-wide host; the others are
 *  <TutorialLayer host=…/> mounted INSIDE a modal, because on iOS a
 *  native-stack modal or an RN <Modal> draws above the root layer. */
export type LayerId = 'root' | 'planPin' | 'scheduleEdit' | 'estimateWizard';

/** Static target ids. A step names one (or a fallback chain) and the screen
 *  wraps the real control in <TutorialTarget id="…">. The source scan in
 *  scripts/validate-tutorial-defs.ts fails the build if a declared id is not
 *  in its declared file. */
export type StaticTargetId =
  // app/daily-report.tsx
  | 'dfr.voice'
  | 'dfr.voicePreview'
  | 'dfr.workPerformed'
  | 'dfr.saveDraft'
  // app/punch-walk.tsx
  | 'punch.camera'
  | 'punch.description'
  | 'punch.save'
  | 'punch.sessionCount'
  | 'punch.back'
  // components/punch/PlanPinStep.tsx (layer planPin)
  | 'punch.planImage'
  | 'punch.pinMarker'
  | 'punch.pinNext'
  // app/invoice.tsx
  | 'invoice.percent'
  | 'invoice.totals'
  | 'invoice.send'
  // BLOCKER SENTINELS (registry BLOCKER_TARGETS). Never lit, never a goal: a
  // screen renders one, childless, while ANY of its layer-less modals is
  // visible (send sheet, retainage ask, contact picker, sub picker, the voice
  // capture sheet, a hub section modal…). On iOS those modals draw ABOVE the
  // root tutorial layer, so while one is up the coach must draw nothing —
  // coachView hides on any mounted blocker (spec §5: no dim under a modal).
  | 'dfr.modalUp'
  | 'voice.modalUp'
  | 'punch.modalUp'
  | 'invoice.modalUp'
  | 'hub.modalUp';

/** Dynamic families: app/project-detail.tsx wraps every hub tile as
 *  id={`hub.tile.${tile.key}`} and every group header as `hub.group.${key}`. */
export type HubTileTargetId = `hub.tile.${string}`;
export type HubGroupTargetId = `hub.group.${string}`;
export type TargetId = StaticTargetId | HubTileTargetId | HubGroupTargetId;

/** Screen-owned helpers registered with useTutorialAssist(id, fn). An assist
 *  fills an input, picks bundled media or drops a pin. It NEVER presses Save,
 *  Send or Apply — the real action stays the user's. */
export type AssistId =
  | 'dfr.useSampleNote'
  | 'punch.useSamplePhoto'
  | 'punch.dropPinKitchen'
  | 'punch.useSampleLine'
  | 'invoice.fillPercent';

// ── Completion signals ──────────────────────────────────────────────────────
// Emitted by the SCREEN right after its existing success point, never from a
// ProjectContext setter (utils/demoSeed.ts calls those setters while seeding,
// which would complete steps by itself).

/** Payload per signal, WITHOUT projectId (added by SignalPayload). Optional
 *  fields are ones a screen may not know at the emit point; the copy and the
 *  stat line degrade instead of inventing a value. */
export interface SignalPayloadMap {
  /** The voice fill (sample chip or mic) was applied to the report. */
  'dfr.voice.applied': { fields: string[]; source: 'sample' | 'mic' };
  /** daily-report handleSave, after addDailyReport, on the non-silent path. */
  'dfr.saved': { reportId: string; status: string; date?: string; crew?: number; offline?: boolean };
  /** A draft photo exists (camera, library or the bundled sample). */
  'punch.photo.added': { source: 'camera' | 'library' | 'sample' };
  /** handlePinNext (pinned: true) / handlePinSkip (pinned: false). */
  'punch.pin.decided': { pinned: boolean };
  /** Debounced 600 ms once the description reaches 3 chars. (`chars` is
   *  optional context; an empty-object type would intersect projectId away.) */
  'punch.description.filled': { chars?: number };
  /** handleSave after onAdd. `sheet` is the plan sheet number when pinned. */
  'punch.saved': { itemId: string; location: string; trade: string; pinned: boolean; sheet?: string; offline?: boolean };
  /** Debounced once progress % > 0 and total > 0. */
  'invoice.amount.set': { total: number };
  /** runConfirmSend success. `to` is the address it went to (self on samples). */
  'invoice.sent': { invoiceId: string; number: number; total: number; to: string };
  /** runConfirmSend failure: the card shows `reason` verbatim. */
  'invoice.send.failed': { reason: string };
}

export type SignalName = keyof SignalPayloadMap;

/** What tutorialSignal(name, payload) takes: the signal's fields plus the
 *  project it happened on. A signal on any other project is ignored. */
export type SignalPayload<N extends SignalName = SignalName> = SignalPayloadMap[N] & { projectId: string };

export type PayloadRecord = { [N in SignalName]?: SignalPayload<N> };

// ── Routes ──────────────────────────────────────────────────────────────────

/** Real expo-router pathnames the engine pushes. Literal so the host can pass
 *  them to router.push without a cast (typed routes). */
export type TutorialPathname =
  | '/daily-report'
  | '/punch-walk'
  | '/invoice'
  | '/project-detail'
  | '/payments-setup'
  | '/tutorials'
  | '/';

/** Which search param carries the project id on that screen. */
export type ProjectParam = 'projectId' | 'id';

export interface StepRoute {
  pathname: TutorialPathname;
  projectParam: ProjectParam;
}

export type RouteParams = Record<string, string | string[] | undefined>;

// ── Copy ────────────────────────────────────────────────────────────────────

/** Everything a copy function may read. `{tap}` / `{Tap}` tokens in the
 *  returned string are resolved afterwards by fillCopy (Tap on touch, Click on
 *  a fine pointer) — a copy function never writes the verb itself. */
export interface CopyCtx {
  /** matchMedia('(pointer: fine)') on web; false on native. */
  pointerFine: boolean;
  web: boolean;
  /** The user's plan is Free — copy mentions the real meter. */
  freeTier: boolean;
  payloads: PayloadRecord;
  userEmail?: string | null;
  /** The last save landed locally only (queued). */
  offline?: boolean;
  /** Pre-formatted report day for the DFR stamp, e.g. 'Tue Sep 23'. */
  reportDayLabel?: string | null;
  /** The run's BOOTED flag: false when the sample plan didn't load (the pin
   *  steps auto-skip, and the camera step says so). Undefined before boot. */
  samplePlan?: boolean;
}

export type Copy = string | ((ctx: CopyCtx) => string);

export interface StepSuccess {
  title: string | ((ctx: CopyCtx) => string);
  sub: (ctx: CopyCtx) => string;
}

// ── Steps and defs ──────────────────────────────────────────────────────────

export type StepUntil =
  | { signal: SignalName }
  | { route: StepRoute }
  | { mounted: TargetId };

export type SkipIf = 'noSamplePlan' | 'noMicOnPlatform';

export interface TutorialStep {
  id: string;
  kind: StepKind;
  /** The screen the step lives on; leaving it pauses the run. */
  route: StepRoute;
  layer?: LayerId;
  /** Fallback chain: the first MOUNTED id wins. */
  target?: TargetId | readonly TargetId[];
  /** ≤ 60 chars after filling, verb-first, uses {tap}/{Tap}. */
  text: Copy;
  textWeb?: Copy;
  /** ≤ 110 chars after filling. */
  detail?: Copy;
  /** Copy override when a fallback target (not the first) is the one used. */
  textByTarget?: Partial<Record<TargetId, Copy>>;
  gesture?: Gesture;
  /** Normalized (0..1) point inside the target for 'tap-point'. */
  point?: { x: number; y: number };
  /** do and wait steps only: the REAL success point that completes the step. */
  until?: StepUntil;
  /** A signal that means the real action failed: the card shows its reason
   *  and the step stays put (invoice.send.failed). */
  failOn?: SignalName;
  success?: StepSuccess;
  assist?: AssistId;
  skipIf?: SkipIf;
  /** Resume restarts here. Always a route-entry step. */
  checkpoint?: boolean;
}

export type TutorialGroup = 'site' | 'money' | 'schedule' | 'client' | 'bid';
export type TutorialPersona = 'contractor' | 'both' | 'client' | 'property_manager';
export type TutorialSandbox = 'sarahs-place' | 'residential-build' | 'current-real';
export type SandboxNeed = 'plan' | 'estimateLines' | 'schedule';

export interface StartCtx {
  /** YYYY-MM-DD, the device's local today. */
  today: string;
  /** tutorialReportDay(): today, or the latest free day on the sample. */
  reportDay: string;
}

export interface TutorialStart {
  pathname: TutorialPathname;
  params: (sandboxId: string, ctx: StartCtx) => Record<string, string>;
  /** Pushed first so the screen's own back / goBack() lands on the sample hub. */
  stackUnder?: { pathname: '/project-detail'; params: (sandboxId: string) => { id: string } };
}

/** The finale's measured stat. `lead` + the measured duration, then extras
 *  built ONLY from real payloads (brain-center honesty rule: no invented
 *  comparison). */
export interface TutorialStat {
  /** The success signal the clock stops on. */
  signal: SignalName;
  /** 'Report filed in' → 'Report filed in 34 s'. */
  lead: string;
  extras?: (payloads: PayloadRecord) => (string | null | undefined)[];
}

export type HandoffRole = 'owner' | 'editor' | 'field';

export interface TutorialHandoff {
  /** The same screen on his newest real job. */
  pathname: TutorialPathname;
  projectParam: ProjectParam;
  /** Extra static params (e.g. type=progress). */
  params?: Record<string, string>;
  /** Button copy for a real job; `name` is already shortened. */
  realJobLabel: (name: string) => string;
  /** Tier the real screen needs; absent = free for everyone. */
  feature?: FeatureKey;
  /** Shown instead when he lacks `feature`: opens the Paywall. */
  paywallLabel?: string;
  /** Roles on a SHARED job that can do the real thing there. */
  roles: readonly HandoffRole[];
  /** Offer 'Connect Stripe' when he isn't connected (invoice only). */
  offerStripe?: boolean;
}

export interface TutorialDef {
  id: TutorialId;
  /** Bump when steps change: a saved run of another version never restores. */
  version: number;
  title: string;
  /** Shown as '· 35 s' / 'each under a minute'. */
  seconds: number;
  /** 'Ends with: …' on the hub card. */
  endsWith: string;
  group: TutorialGroup;
  personas: readonly TutorialPersona[];
  /** An invited field seat may run it (on his OWN sample). */
  fieldSeatOk: boolean;
  sandbox: TutorialSandbox;
  needs: readonly SandboxNeed[];
  /** Features the practice pass opens on the sandbox while the run is live. */
  practiceFeatures: readonly FeatureKey[];
  start: TutorialStart;
  steps: readonly TutorialStep[];
  stat: TutorialStat;
  handoff: TutorialHandoff;
  chainNext?: { tutorialId: TutorialId; label: string };
}

export type TutorialDefs = Readonly<Partial<Record<TutorialId, TutorialDef>>>;

// ── Run state ───────────────────────────────────────────────────────────────

export type TutorialEntry = 'onboarding' | 'chip' | 'checklist' | 'paywall' | 'hub' | 'chain';
export type RunPhase = 'boot' | 'step' | 'celebrate' | 'finale';
export type PauseReason = 'offroute' | 'background' | 'restored';
export type ExitReason =
  | 'skip'
  | 'esc'
  | 'offroute_timeout'
  | 'background'
  | 'sample_gone'
  | 'signed_out'
  | 'persona_changed'
  | 'boot_failed';
export type StepVia = 'signal' | 'next' | 'skip_ahead' | 'skip_step' | 'assist';

/** Facts the host learns while booting the sandbox. */
export interface BootFlags {
  /** The sample plan sheet is on the sandbox (false → pin steps auto-skip). */
  samplePlan: boolean;
  /** A working mic on this platform (false on web). */
  mic: boolean;
}

export interface StepLogEntry {
  stepId: string;
  stepIndex: number;
  via: StepVia;
  /** Time on the step, from stepEnteredAt. */
  ms: number;
  at: number;
}

export interface CurrentRoute {
  pathname: string;
  params: RouteParams;
}

export interface IdleState {
  status: 'idle';
}

export interface RunningState {
  status: 'running';
  tutorialId: TutorialId;
  version: number;
  sandboxProjectId: string;
  /** current-real mode only (the first-bid coach). */
  realProjectId?: string | null;
  entry: TutorialEntry;
  returnTo?: string | null;
  phase: RunPhase;
  stepIndex: number;
  stepEnteredAt: number;
  /** Entry time of the first do step — the stat's clock start. */
  firstActionAt?: number;
  startedAt: number;
  paused: false | { reason: PauseReason; at: number };
  targetMissing: boolean;
  stuck: boolean;
  /** Step ids jumped over (skip-ahead, SKIP_STEP, skipIf). */
  skipped: string[];
  assists: { stepId: string; assistId: AssistId; at: number }[];
  payloads: PayloadRecord;
  signalAt: Partial<Record<SignalName, number>>;
  celebrate?: { stepId: string; signal: SignalName | null; at: number };
  failure?: { stepId: string; signal: SignalName; reason: string; at: number };
  flags: BootFlags;
  /** Last ROUTE seen, whatever the phase — step entry pauses against it. */
  route: CurrentRoute | null;
  /** TutorialTarget ids currently mounted (fed by TARGET events). */
  mounted: string[];
  /** Completed steps in order; the host turns new entries into
   *  tutorial_step_completed events. */
  log: StepLogEntry[];
  finaleAt?: number;
}

export interface FinishedState {
  status: 'finished';
  tutorialId: TutorialId;
  outcome: 'completed' | 'exited';
  reason?: ExitReason;
  atStepId: string | null;
  endedAt: number;
  sandboxProjectId: string;
  /** Kept so the finale's stat and analytics can still be read after FINISH. */
  startedAt: number;
}

export type RunState = IdleState | RunningState | FinishedState;

/** The `active` slot of mageid_tutorials_v1 — written at checkpoints only. */
export interface SavedActiveRun {
  tutorialId: TutorialId;
  version: number;
  /** Always a checkpoint step index. */
  stepIndex: number;
  sandboxProjectId: string;
  entry: TutorialEntry;
  returnTo?: string | null;
  /** epoch ms */
  savedAt: number;
}

export type TutorialEvent =
  | {
      type: 'START';
      tutorialId: TutorialId;
      sandboxProjectId: string;
      realProjectId?: string | null;
      entry: TutorialEntry;
      returnTo?: string | null;
      now: number;
    }
  | { type: 'BOOTED'; flags: BootFlags; mounted?: readonly string[]; now: number }
  | { type: 'ROUTE'; pathname: string; params: RouteParams; now: number }
  | { type: 'TARGET'; id: string; mounted: boolean; now: number }
  | { type: 'TARGET_TIMEOUT'; now: number }
  | { type: 'STUCK'; now: number }
  | { [N in SignalName]: { type: 'SIGNAL'; name: N; payload: SignalPayload<N>; now: number } }[SignalName]
  | { type: 'NEXT'; now: number }
  | { type: 'SKIP_STEP'; now: number }
  | { type: 'ASSIST'; assistId: AssistId; now: number }
  | { type: 'CELEBRATION_DONE'; now: number }
  | { type: 'FINISH'; now: number }
  | { type: 'PAUSE'; reason: Exclude<PauseReason, 'restored'>; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'EXIT'; reason: ExitReason; now: number }
  | { type: 'RESTORE'; saved: SavedActiveRun; sampleExists: boolean; now: number };

// ── Geometry and the coach view ─────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface CoachEnv {
  /** Target rects in the coordinates of the layer that owns them
   *  (target.measureInWindow − layer.measureInWindow). Absent = unmounted. */
  rects: Partial<Record<string, Rect>>;
  /** Size of the layer the step draws in. */
  viewport: Size;
  mountedLayers: readonly LayerId[];
  screenReader: boolean;
  keyboardH: number;
  now: number;
}

export type CardReason = 'missing' | 'offscreen' | 'screenreader' | 'failed' | 'untargeted';

export type CoachView =
  | { kind: 'hidden' }
  /** onSample: the current screen belongs to the sandbox (show the pill there). */
  | { kind: 'paused'; reason: PauseReason; onSample: boolean }
  | { kind: 'card'; reason: CardReason; layer: LayerId; stepId: string; scroll?: 'up' | 'down'; targetId?: string }
  | { kind: 'spotlight'; layer: LayerId; stepId: string; targetId: string; rect: Rect }
  | { kind: 'celebrate'; layer: LayerId; stepId: string }
  | { kind: 'finale' };

// ── Progress blob (mageid_tutorials_v1) ─────────────────────────────────────

export type TutorialStatus = 'new' | 'in_progress' | 'practised' | 'exited';

export interface TutorialProgressEntry {
  status: TutorialStatus;
  version: number;
  checkpointStepId?: string;
  startedAt?: string;
  completedAt?: string;
  exitedAt?: string;
  bestMs?: number;
}

export interface TutorialProgress {
  v: 1;
  byId: Partial<Record<TutorialId, TutorialProgressEntry>>;
  active?: SavedActiveRun;
  chips: Partial<Record<TutorialId, { shownAt?: string; dismissedAt?: string }>>;
  /** YYYY-MM-DD of the last chip shown anywhere — at most one per day. */
  lastChipDay?: string;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export type SampleDfrParse = Partial<DailyFieldReport>;
export type SampleEstimateLine = LinkedEstimateItem;
