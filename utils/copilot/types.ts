// utils/copilot/types.ts — MAGE Copilot engine contracts.
//
// One engine, many capabilities. A feature registers a CopilotCapability that
// declares FOUR things: grounding (its own history), gaps (what's still
// unresolved), the draft schema + per-turn prompt, and apply (persist). The
// engine owns the turn loop, the "ask only when it matters" discipline, the
// confirm-back, and the review→apply handoff. Pure types; no runtime imports
// except the domain Project type.
import type { Project } from '@/types';
import type { AIFeature } from '@/utils/aiRateLimiterCore';

export type CopilotCapabilityId =
  | 'schedule' | 'estimate' | 'daily_report' | 'change_order'
  | 'rfi' | 'punch' | 'safety_incident' | 'invoice' | 'submittal'
  | 'warranty' | 'toolbox_talk' | 'new_project'
  | 'jha' | 'lead' | 'permit' | 'hazard'
  | 'scheduleEdit' | 'estimateEdit';

/** A field the interview may need. `impact` 0..1 ranks urgency; a gap below the
 *  ask threshold is NEVER asked — the engine states `groundedDefault` instead. */
export interface Gap {
  field: string;
  impact: number;
  question: string;
  /** `source`: 'history' only when the default really comes from his own
   *  records (a saved setting, his past jobs); anything else is an assumption
   *  and the shell files it under "ASSUMED — CHANGE ON THE GRID", never under
   *  "SET FROM YOUR HISTORY" (#7). Unset = assumed. */
  groundedDefault: { value: unknown; basis: string; source?: 'history' | 'assumed' };
  kind: 'number' | 'text' | 'enum' | 'date' | 'choice';
  choices?: { label: string; value: unknown; basis?: string; recommended?: boolean }[];
  /** Input hint for `text`/`number` gaps (rendered as the field placeholder). */
  placeholder?: string;
}

/** Compact, serializable snapshot of the contractor's own history that the
 *  interview cites. Built once per session by the capability. */
export interface Grounding {
  facts: string[];
  data: Record<string, unknown>;
}

/** Everything a capability needs to read history + persist. Assembled by the
 *  shell; no capability touches Supabase directly. */
export interface CopilotContext {
  project: Project | null;
  projectId: string;
  ctx: any;
  /** SafetyContext value (adders + readers for JHAs, toolbox talks, incidents,
   *  hazards). Injected by the copilot host so safety-family capabilities can
   *  persist without routing. Undefined outside the provider. */
  safety?: any;
  /** Injected by the schedule-edit panel: the desktop editor's undo-safe
   *  commit + the live task array + the CPM options it renders with, so an
   *  edit capability can preview + apply against exactly what's on screen. */
  commitTasks?: (producer: (prev: import('@/types').ScheduleTask[]) => import('@/types').ScheduleTask[]) => void;
  currentTasks?: import('@/types').ScheduleTask[];
  cpmOptions?: import('@/utils/cpm').RunCpmOptions;
  tier: string;
}

export interface CopilotCapability<Draft = any, Applied = any> {
  id: CopilotCapabilityId;
  label: string;
  featureKey?: string;
  /** Which metered AI feature this capability draws on (per-tier caps + free
   *  lifetime trials live in aiRateLimiterCore). Schedule uses scheduleCopilot,
   *  Estimate uses quickEstimate, etc. */
  aiFeature: AIFeature;
  /** The meter the INTERVIEW turns draw on, when it differs from aiFeature.
   *  The turns are cheap field extraction; the estimate capability meters them
   *  as 'copilot' and charges its quickEstimate trial on the one pricing call,
   *  so a Copilot estimate costs one trial, not two (#35/#38). Unset =
   *  aiFeature. The mageAI call keeps `feature: aiFeature` for the server tag. */
  turnMeterFeature?: AIFeature;
  maxQuestions?: number;
  askThreshold?: number;
  buildGrounding(ctx: CopilotContext): Promise<Grounding>;
  gaps(draft: Draft, grounding: Grounding): Gap[];
  buildTurnPrompt(a: { transcript: string; draft: Draft; grounding: Grounding; asking: Gap | null }): { prompt: string; schemaHint: object };
  /** Fold the AI's JSON into the running draft. `meta` (optional, back-compat)
   *  carries the raw utterance + the gap being answered so a capability can
   *  refuse a field the model presumed but the user never stated. */
  mergeDraft(draft: Draft, aiJson: any, meta?: { transcript: string; asking: Gap | null }): Draft;
  apply(draft: Draft, ctx: CopilotContext): Promise<Applied>;
  suggestions: string[];
  topicChecklist?: { label: string; hint?: string }[];
  /** Per-capability presentation copy so ONE shell serves every capability
   *  (schedule/estimate/…). Keeps domain nouns out of CopilotShell. */
  copy: CopilotCopy;
  /** When present, the shell's review phase renders THIS (e.g. an edit diff)
   *  instead of the generic reviewHeadline + Build button, wiring the passed
   *  confirm/cancel to the diff's Apply/Discard. */
  renderReview?(a: {
    draft: Draft; ctx: CopilotContext; confirm: () => void; cancel: () => void;
    /** Write into the draft without leaving review (e.g. the estimate review
     *  stores its priced lines and the markup he picked, so Build commits
     *  exactly what he saw — #38). */
    patchDraft?: (patch: Partial<Draft>) => void;
    /** Why the interview stopped early, when it did (e.g. the AI limit). */
    note?: string;
  }): import('react').ReactNode;
}

export interface CopilotCopy {
  /** VoiceCaptureModal title, e.g. "Build a schedule" / "Price an estimate". */
  voiceTitle: string;
  /** Compose-phase eyebrow (default "TELL ME ABOUT THE JOB"). */
  composeEyebrow?: string;
  /** Compose-phase question (default "What are we building?"). */
  composeQuestion?: string;
  /** Compose-phase hint under the question. */
  composeHint?: string;
  /** Review-phase headline, e.g. "Here's your schedule, grounded in your jobs." */
  reviewHeadline: string;
  /** Review-phase sub-line (cite the web surface for fine-tuning). */
  reviewSub: string;
  /** Applying-phase spinner label, e.g. "Building your schedule…". */
  buildingLabel: string;
  /** Route the "Open on web to fine-tune" escape opens (with {id} param). */
  webRoute: string;
}

export type CopilotPhase =
  | 'idle' | 'listening' | 'thinking' | 'asking' | 'confirming'
  | 'review' | 'applying' | 'done' | 'error';

export interface TranscriptTurn { id: string; text: string; edited?: boolean }

export interface CopilotState<Draft = any> {
  phase: CopilotPhase;
  capabilityId: CopilotCapabilityId;
  draft: Draft;
  grounding: Grounding;
  transcript: TranscriptTurn[];
  askedFields: string[];
  currentGap: Gap | null;
  resolved: { field: string; label: string; basis: string; source?: 'history' | 'assumed' }[];
  questionCount: number;
  /** Set on an error: apply-phase (Build) errors keep the draft and can go
   *  back to review; turn-phase errors re-open the mic. Limit reasons
   *  (lifetime_cap / smart_cap / pro_only / daily_cap / monthly_cap) show
   *  'See plans'; 'no_project' / 'no_estimate' offer the fix (#34/#35). */
  errorKind?: string;
  errorMessage?: string;
  /** Shown on the review card when the interview was cut short (#35: "AI limit
   *  reached — built from what you said so far"). */
  reviewNote?: string;
}

export type CopilotAction<Draft = any> =
  | { type: 'START'; grounding: Grounding }
  | { type: 'UTTERANCE'; turnId: string; text: string }
  | { type: 'EDIT_TRANSCRIPT'; turnId: string; text: string }
  | { type: 'AI_DRAFT'; draft: Draft; resolved: CopilotState['resolved']; nextGap: Gap | null; ready: boolean; note?: string }
  | { type: 'PATCH_DRAFT'; patch: Partial<Draft> }
  | { type: 'BACK_TO_REVIEW' }
  | { type: 'ANSWER'; field: string; value: unknown }
  | { type: 'SKIP_QUESTION' }
  | { type: 'CONFIRM' }
  | { type: 'APPLY_OK' }
  | { type: 'APPLY_ERR'; errorKind: string; message: string }
  | { type: 'CANCEL' };

export type AskDecision =
  | { kind: 'ask'; gap: Gap }
  | { kind: 'ready' }
  | { kind: 'capped' };
