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
  | 'rfi' | 'punch' | 'safety_incident' | 'invoice';

/** A field the interview may need. `impact` 0..1 ranks urgency; a gap below the
 *  ask threshold is NEVER asked — the engine states `groundedDefault` instead. */
export interface Gap {
  field: string;
  impact: number;
  question: string;
  groundedDefault: { value: unknown; basis: string };
  kind: 'number' | 'text' | 'enum' | 'date' | 'choice';
  choices?: { label: string; value: unknown; basis?: string; recommended?: boolean }[];
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
}

export interface CopilotCopy {
  /** VoiceCaptureModal title, e.g. "Build a schedule" / "Price an estimate". */
  voiceTitle: string;
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
  resolved: { field: string; label: string; basis: string }[];
  questionCount: number;
  errorKind?: string;
  errorMessage?: string;
}

export type CopilotAction<Draft = any> =
  | { type: 'START'; grounding: Grounding }
  | { type: 'UTTERANCE'; turnId: string; text: string }
  | { type: 'EDIT_TRANSCRIPT'; turnId: string; text: string }
  | { type: 'AI_DRAFT'; draft: Draft; resolved: CopilotState['resolved']; nextGap: Gap | null; ready: boolean }
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
