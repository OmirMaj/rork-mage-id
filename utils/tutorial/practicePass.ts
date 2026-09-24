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

import type { FeatureKey, RunState, TutorialDefs } from './types';
import { TUTORIAL_DEFS } from './defs';

export const TUTORIAL_PRACTICE_PASS = true;

/** After a run ends the host pops the gated screen first, then the pass
 *  clears. The grace covers the pop animation so no Paywall flashes. */
export const PRACTICE_GRACE_MS = 1500;

/** The only features a pass may ever open (spec §11). A def listing anything
 *  else is refused here AND by validate-tutorial-defs. */
export const PRACTICE_FEATURES_ALLOWED: readonly FeatureKey[] = [
  'punch_list_closeout',
  'change_orders_invoicing',
  'client_portal',
  'schedule_gantt_pdf',
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
