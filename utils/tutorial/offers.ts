// utils/tutorial/offers.ts — who is offered which tutorial, and when. Pure.
//
// The contextual chip is the one entry point that shows on a REAL job, so it
// is the one most able to nag. Its rules are deliberately stingy: once per
// tutorial, × is forever, at most one chip per day across the whole app,
// never on a sample, never mid-draft, never with the keyboard up, and never
// for a tutorial he already practised or walked out of.

import type { TutorialDef, TutorialDefs, TutorialId, TutorialPersona, TutorialProgress } from './types';
import { TUTORIAL_DEFS, TUTORIAL_ORDER } from './defs';

export interface ChipCtx {
  tutorialId: TutorialId;
  persona: TutorialPersona | null | undefined;
  fieldOnly: boolean;
  /** The screen's project is a sample (never offer there). */
  projectIsSample: boolean;
  /** The screen actually opened (not paywalled). */
  screenOpened: boolean;
  /** He has typed / captured something on this screen already. */
  midDraft: boolean;
  keyboardUp: boolean;
  /** A tutorial run is live (chips hide during a run). */
  runActive: boolean;
  /** Local YYYY-MM-DD. */
  today: string;
}

export function shouldOfferChip(progress: TutorialProgress, ctx: ChipCtx, defs: TutorialDefs = TUTORIAL_DEFS): boolean {
  if (ctx.runActive || ctx.projectIsSample || !ctx.screenOpened || ctx.midDraft || ctx.keyboardUp) return false;
  if (!tutorialsForUser(ctx.persona, ctx.fieldOnly, defs).some(d => d.id === ctx.tutorialId)) return false;
  const entry = progress.byId[ctx.tutorialId];
  if (entry && (entry.status === 'practised' || entry.status === 'exited')) return false;
  const chip = progress.chips[ctx.tutorialId];
  if (chip?.dismissedAt || chip?.shownAt) return false;
  if (progress.lastChipDay === ctx.today) return false;
  return true;
}

/**
 * The tutorials this user may see, in hub order.
 *   • client / property_manager personas: none (the hub explains why, and the
 *     Help-sheet row is hidden for them) — homeowners never get a tour;
 *   • an invited field seat: only the fieldSeatOk ones (daily report, punch);
 *   • contractor / both (or not yet chosen): every def their persona lists.
 */
export function tutorialsForUser(
  persona: TutorialPersona | null | undefined,
  fieldOnly: boolean,
  defs: TutorialDefs = TUTORIAL_DEFS,
): TutorialDef[] {
  if (persona === 'client' || persona === 'property_manager') return [];
  const p: TutorialPersona = persona ?? 'contractor';
  const out: TutorialDef[] = [];
  for (const id of TUTORIAL_ORDER) {
    const d = defs[id];
    if (!d || !d.personas.includes(p)) continue;
    if (fieldOnly && !d.fieldSeatOk) continue;
    out.push(d);
  }
  return out;
}

export type CardStatus =
  | { kind: 'new'; label: 'New' }
  | { kind: 'continue'; label: string; stepNumber: number; stepCount: number }
  | { kind: 'practised'; label: 'Practised · Replay' };

/** The hub card's pill. 'Continue · step 3 of 8' only for a saved run of the
 *  CURRENT def version (an older save can't be restored anyway). */
export function tutorialCardStatus(progress: TutorialProgress, def: TutorialDef): CardStatus {
  const a = progress.active;
  if (a && a.tutorialId === def.id && a.version === def.version) {
    const stepNumber = Math.min(Math.max(a.stepIndex, 0), def.steps.length - 1) + 1;
    return { kind: 'continue', label: `Continue · step ${stepNumber} of ${def.steps.length}`, stepNumber, stepCount: def.steps.length };
  }
  if (progress.byId[def.id]?.status === 'practised') return { kind: 'practised', label: 'Practised · Replay' };
  return { kind: 'new', label: 'New' };
}

/** '35 s' for card and chip copy. */
export function durationLabel(def: TutorialDef): string {
  return def.seconds < 60 ? `${def.seconds} s` : `${Math.round(def.seconds / 60)} min`;
}

export const EMPTY_PROGRESS: TutorialProgress = { v: 1, byId: {}, chips: {} };
