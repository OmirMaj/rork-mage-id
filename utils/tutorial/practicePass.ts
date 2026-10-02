// utils/tutorial/practicePass.ts — the founder's practice-pass decision as one
// switch and one pure rule.
//
// THE DECISION (founder, 2026-09-23, taken at the spec's default: ON). Punch
// walk is Business and invoicing is Pro; a new user is on Free, so without a
// pass those tutorials would hit a paywall on step 1. With it, ANYONE may
// practise them — on the SAMPLE project only, only for the features that
// tutorial lists, and only while its run is live.
//
// WHY THIS IS SAFE. Tier gating is monetisation, not security (see the header
// of utils/collaboratorAccess.ts). RLS is untouched and punch / invoice / plan
// writes carry no server tier check, so the pass opens no server hole; it
// never touches AI meters. It is client-side and bounded to a live run.
//
// Set TUTORIAL_PRACTICE_PASS = false to turn it off: practiceAllows then
// returns false for everything, and the entry points show those tutorials
// only to users whose plan already includes them.
//
// THE LEARN WAVE (founder default FQ1, 2026-10-01). The pass also opens pay
// applications (aia_pay_app), the time clock (subcontractor_management), plan
// markup (plan_markup), the takeoff's estimate step (ai_estimate_wizard), Ask
// your plans (ask_your_plans) and Construction AI — whose TAB gates on
// ai_code_check (app/(tabs)/construction-ai/index.tsx) and whose Ask mode
// gates on construction_answer (components/construction/AskConstructionMode).
// Same bounds: the sample only, the features that tutorial's def lists, while
// its run is live.
//
// THE AI INVARIANT — WHY AN AI-BACKED FEATURE MAY BE OPENED AT ALL. Several of
// those features normally spend AI credits. The pass may open them ONLY
// because, on a sample while a pass is live:
//   1. every AI step in a tutorial is FIXTURE-backed: the answer is bundled
//      data, labelled on screen with SAMPLE_NO_CREDITS_LABEL
//      (utils/tutorial/fixtures.ts) — no server call, no meter change; and
//   2. the screen REFUSES typed / spoken AI input (and every other AI run the
//      gate opens: Code check, Plan review, Roadmap, plan Ask, the estimate
//      wizard's AI fill) on the sample while the pass is what let him in.
// The AI entry points this pass opens on a sample — each guarded by its
// content lane (LEARNDEFS-A / LEARNDEFS-B source scans):
//   ai_code_check        Construction AI tab: Code check, Plan review, Roadmap
//   construction_answer  Construction AI Ask mode (AskConstructionMode)
//   ask_your_plans       the plan room's Ask modal (app/plans.tsx, AskPlansPanel)
//   ai_estimate_wizard   the estimate wizard's AI fill (app/estimate-wizard.tsx)
//   plan_markup          takeoff on a plan sheet (app/takeoff.tsx)
// A later lane that lets one of them call the server on a sample, or bill a
// meter there, breaks the reason this list is allowed: remove the feature
// from PRACTICE_FEATURES_ALLOWED instead. There is still no server-side
// tutorial exemption, ever (fixtures.ts header).

import type { FeatureKey, RunState, TutorialDefs } from './types';
import { TUTORIAL_DEFS } from './defs';

export const TUTORIAL_PRACTICE_PASS = true;

/** After a run ends the host pops the gated screen first, then the pass
 *  clears. The grace covers the pop animation so no Paywall flashes. */
export const PRACTICE_GRACE_MS = 1500;

/** The only features a pass may ever open (spec §11, plus the LEARN wave's
 *  seven above). A def listing anything else is refused here AND by
 *  validate-tutorial-defs. */
export const PRACTICE_FEATURES_ALLOWED: readonly FeatureKey[] = [
  'punch_list_closeout',
  'change_orders_invoicing',
  'client_portal',
  'schedule_gantt_pdf',
  // LEARN wave (FQ1). The AI ones stand on THE AI INVARIANT above.
  'aia_pay_app',
  'subcontractor_management',
  'plan_markup',
  'ai_estimate_wizard',
  'ask_your_plans',
  'ai_code_check',
  'construction_answer',
];

/** Every feature the pass opens right now on `projectId`. Empty when idle,
 *  on any other project, or when the switch is off. */
export function practiceFeatures(
  state: RunState,
  projectId: string | null | undefined,
  now: number,
  defs: TutorialDefs = TUTORIAL_DEFS,
): FeatureKey[] {
  if (!TUTORIAL_PRACTICE_PASS || !projectId) return [];
  if (state.status === 'idle') return [];
  if (state.sandboxProjectId !== projectId) return [];
  if (state.status === 'finished' && now - state.endedAt >= PRACTICE_GRACE_MS) return [];
  if (state.status === 'finished' && now < state.endedAt) return [];
  // A RESTORED run is a saved run brought back paused at launch. Nothing on
  // screen is teaching him and it never times out (autoExitReason leaves it
  // alone), so a pass here would open Business / Pro screens on the sample for
  // the whole session. Only Resume (RESUME lifts this pause) brings it back —
  // the same rule store.ts uses for "is a run live". Offroute / background
  // pauses keep the pass: he is coming back to the same screen.
  if (state.status === 'running' && state.paused && state.paused.reason === 'restored') return [];
  const def = defs[state.tutorialId];
  // current-real mode (the first-bid coach) never gets a pass: it runs on his
  // real job, where the plan he pays for is the only gate.
  if (!def || def.sandbox === 'current-real') return [];
  return def.practiceFeatures.filter(f => PRACTICE_FEATURES_ALLOWED.includes(f));
}

/** True only when a run is running or paused (or ended < 1.5 s ago), the
 *  project is that run's sandbox, and the feature is one its def lists. */
export function practiceAllows(
  state: RunState,
  projectId: string | null | undefined,
  feature: FeatureKey,
  now: number,
  defs: TutorialDefs = TUTORIAL_DEFS,
): boolean {
  return practiceFeatures(state, projectId, now, defs).includes(feature);
}
