// utils/tutorial/entryPoints.ts — the pure rules behind the doors INTO a
// tutorial: the /tutorials hub's cards, the onboarding auto-start, the
// checklist's 'Show me first' rows, the Help-sheet row and the contextual
// chip's return address. Pure (no react / react-native), so
// scripts/validate-tutorial-entry-points.ts runs every rule under bun.
//
// WHY THESE LIVE TOGETHER. Each door answers the same three questions — may
// this user see this tutorial, what does it cost him, what state is it in —
// and when those answers were spread over five screens they drifted (the old
// slideshow had one door buried in Settings). One module, one answer.

import type { FeatureKey } from '@/utils/featureTiers';
import { REQUIRED_TIER } from '@/utils/featureTiers';
import type { TutorialDef, TutorialDefs, TutorialGroup, TutorialId, TutorialPersona, TutorialProgress } from './types';
import { TUTORIAL_DEFS } from './defs';
import { tutorialsForUser, tutorialCardStatus, durationLabel, type CardStatus } from './offers';

// ── Onboarding auto-start ───────────────────────────────────────────────────

/**
 * The ONE place a tutorial starts by itself (spec entry point 1): a new
 * contractor (or 'both') who has just tapped 'Try it on a sample job'. Never
 * when a deep link is waiting to replay — he came for that screen, and the
 * invite / shared link wins — and never for a client or property manager,
 * who have no job to file a report on. An unknown persona does not start it:
 * onboarding runs after persona-select, so null means the role read failed,
 * and a tour nobody asked for is worse than no tour.
 */
export function shouldAutoStartOnboardingTutorial(a: {
  persona: TutorialPersona | null | undefined;
  replayTarget: string | null | undefined;
}): boolean {
  if (a.replayTarget) return false;
  return a.persona === 'contractor' || a.persona === 'both';
}

export const ONBOARDING_TUTORIAL_ID: TutorialId = 'daily-report-voice';

// ── Help-sheet row ──────────────────────────────────────────────────────────

/** The Help sheet's 'Tutorials' row. Hidden for the homeowner-side personas:
 *  there is nothing for them to practise, and the hub would only explain so. */
export function helpTutorialsRowVisible(persona: TutorialPersona | null | undefined): boolean {
  return persona !== 'client' && persona !== 'property_manager';
}

// ── Hub cards ───────────────────────────────────────────────────────────────

export const HUB_GROUPS: readonly { group: TutorialGroup; label: string }[] = [
  { group: 'site', label: 'On site' },
  { group: 'money', label: 'Money' },
  { group: 'schedule', label: 'Schedule' },
  { group: 'client', label: 'Your client' },
  { group: 'bid', label: 'Estimating' },
];

const TIER_NAME: Record<'free' | 'pro' | 'business', string> = { free: 'Free', pro: 'Pro', business: 'Business' };
const TIER_RANK: Record<'free' | 'pro' | 'business', number> = { free: 0, pro: 1, business: 2 };

/**
 * The highest plan among the features this tutorial practises that the user
 * does NOT have, or null when his plan covers them all. Punch walk lists
 * punch_list_closeout → 'business'; invoicing lists change_orders_invoicing →
 * 'pro'; the daily report lists nothing → null.
 */
export function missingTierFor(def: Pick<TutorialDef, 'practiceFeatures'>, canAccess: (f: FeatureKey) => boolean): 'pro' | 'business' | null {
  let worst: 'free' | 'pro' | 'business' = 'free';
  for (const f of def.practiceFeatures) {
    if (canAccess(f)) continue;
    const t = REQUIRED_TIER[f];
    if (TIER_RANK[t] > TIER_RANK[worst]) worst = t;
  }
  return worst === 'free' ? null : worst;
}

/** 'Business — practise free on the sample'. Only while the pass is on: with
 *  it off, the card is not shown at all (see hubCards), so the tag never
 *  promises a practice run that would hit a paywall on step 1. */
export function tierTagFor(
  def: Pick<TutorialDef, 'practiceFeatures'>,
  canAccess: (f: FeatureKey) => boolean,
  practicePass: boolean,
): string | null {
  const missing = missingTierFor(def, canAccess);
  if (!missing || !practicePass) return null;
  return `${TIER_NAME[missing]} — practise free on the sample`;
}

export interface HubCard {
  id: TutorialId;
  title: string;
  duration: string;
  endsWith: string;
  status: CardStatus;
  tierTag: string | null;
}

export interface HubSection {
  group: TutorialGroup;
  label: string;
  cards: HubCard[];
}

export interface HubCtx {
  persona: TutorialPersona | null | undefined;
  fieldOnly: boolean;
  progress: TutorialProgress;
  canAccess: (f: FeatureKey) => boolean;
  /** utils/tutorial/practicePass TUTORIAL_PRACTICE_PASS. */
  practicePass: boolean;
}

/**
 * The hub's sections, in HUB_GROUPS order, empty groups dropped.
 *   • who: tutorialsForUser (field seats get daily report + punch only; the
 *     client-side personas get nothing — the screen explains why);
 *   • the founder's switch: with the practice pass OFF, a tutorial whose
 *     features his plan lacks is hidden, because it would open on a Paywall;
 *   • each card carries its status pill (New / Continue · step 3 of 8 /
 *     Practised · Replay) and its tier tag.
 */
export function hubSections(ctx: HubCtx, defs: TutorialDefs = TUTORIAL_DEFS): HubSection[] {
  const visible = tutorialsForUser(ctx.persona, ctx.fieldOnly, defs)
    .filter(d => ctx.practicePass || missingTierFor(d, ctx.canAccess) === null);
  const out: HubSection[] = [];
  for (const g of HUB_GROUPS) {
    const cards = visible
      .filter(d => d.group === g.group)
      .map(d => ({
        id: d.id,
        title: d.title,
        duration: durationLabel(d),
        endsWith: d.endsWith,
        status: tutorialCardStatus(ctx.progress, d),
        tierTag: tierTagFor(d, ctx.canAccess, ctx.practicePass),
      }));
    if (cards.length) out.push({ group: g.group, label: g.label, cards });
  }
  return out;
}

/** Why the hub is empty, in words he can act on — or null when it has cards. */
export function hubEmptyReason(persona: TutorialPersona | null | undefined, sections: readonly HubSection[]): string | null {
  if (sections.length > 0) return null;
  if (persona === 'client' || persona === 'property_manager') {
    return 'Tutorials practise running a job — daily reports, punch walks, invoices. Your contractor runs those and shares the results with you, so there is nothing here to practise.';
  }
  return 'No tutorials are available on your plan right now.';
}

// ── Getting-started checklist ───────────────────────────────────────────────

export type ChecklistRowKey = 'tryit' | 'invoice';

const CHECKLIST_TUTORIAL: Record<ChecklistRowKey, TutorialId> = {
  tryit: 'daily-report-voice',
  invoice: 'invoice-to-self',
};

export type ChecklistShowMe =
  | { kind: 'offer'; tutorialId: TutorialId; label: string }
  | { kind: 'practised'; tutorialId: TutorialId; label: 'Practised' };

/**
 * The secondary line under a checklist row. 'Show me first · 35 s' on the
 * 'Try it' row and 'Show me first · 40 s' on 'Send your first invoice'.
 * Practising NEVER ticks the row — practising is not doing, and the metric is
 * practised → done for real within 7 days — so a practised tutorial shows a
 * small 'Practised' tag and the row keeps its real-state tick logic.
 * Nothing on a done row, and nothing for a tutorial this user can't see.
 */
export function checklistShowMe(
  key: string,
  a: { done: boolean; persona: TutorialPersona | null | undefined; fieldOnly: boolean; progress: TutorialProgress; canAccess: (f: FeatureKey) => boolean; practicePass: boolean },
  defs: TutorialDefs = TUTORIAL_DEFS,
): ChecklistShowMe | null {
  if (a.done) return null;
  if (key !== 'tryit' && key !== 'invoice') return null;
  const id = CHECKLIST_TUTORIAL[key];
  const def = tutorialsForUser(a.persona, a.fieldOnly, defs).find(d => d.id === id);
  if (!def) return null;
  if (!a.practicePass && missingTierFor(def, a.canAccess) !== null) return null;
  if (a.progress.byId[id]?.status === 'practised') return { kind: 'practised', tutorialId: id, label: 'Practised' };
  return { kind: 'offer', tutorialId: id, label: `Show me first · ${durationLabel(def)}` };
}

// ── Contextual chip ─────────────────────────────────────────────────────────

/** 'New here? Practise once on a sample job · 35 s'. */
export function chipCopy(def: TutorialDef): string {
  return `New here? Practise once on a sample job · ${durationLabel(def)}`;
}

/**
 * Where the finale's 'Back to <job>' returns: the screen the chip was on, as
 * a path plus its string params. The host's parseReturnTo reads exactly this
 * shape and ignores anything it doesn't know, so an odd param is harmless.
 */
export function chipReturnTo(pathname: string, params: Record<string, string | string[] | undefined>): string {
  const parts: string[] = [];
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (typeof v !== 'string' || !v) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? `${pathname}?${parts.join('&')}` : pathname;
}
