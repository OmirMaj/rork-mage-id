// utils/paywallPracticeOffer.ts — whether a Paywall offers "Try it free on a
// sample job first". Pure (bun-runnable): components/Paywall.tsx wires it in.
//
// WHY. Punch walk is Business and invoicing is Pro, and a new user is on Free.
// Without this the paywall is a dead end; with it, it becomes "feel it, then
// buy it" — he practises the feature on the SAMPLE job under the practice pass
// (utils/tutorial/practicePass), then the finale hands him back to the plans.
//
// The offer shows only when ALL hold:
//   • the practice pass is on (TUTORIAL_PRACTICE_PASS) — switched off, the
//     paywall is exactly what it was;
//   • the caller named a tutorial that exists and actually practises a gated
//     feature (a def with no practiceFeatures cannot get past this wall);
//   • progress has loaded and that tutorial is not already practised (he has
//     felt it; the wall is now an honest price question);
//   • no tutorial run is live — a paywall reached mid-run would otherwise end
//     the run he is in. A RESTORED run (a saved run brought back paused at
//     launch) does not count: it carries no practice pass, so on a web reload
//     of the sample's gated screen this wall is what he meets, and its offer is
//     his way back in — the host turns a start of the same tutorial into
//     Resume, and the label says so (runBlocksPaywallOffer / restoredRunId).

import type { RunState, TutorialDefs, TutorialId, TutorialProgress } from '@/utils/tutorial/types';
import { TUTORIAL_DEFS } from '@/utils/tutorial/defs';
import { TUTORIAL_PRACTICE_PASS } from '@/utils/tutorial/practicePass';
import { durationLabel } from '@/utils/tutorial/offers';

export interface PaywallPracticeOffer {
  tutorialId: TutorialId;
  /** "Try it free on a sample job first · 45 s" */
  label: string;
  /** One honest line under it. */
  sub: string;
}

export const PAYWALL_PRACTICE_SUB = 'Practise on a sample job — nothing goes to a client or a sub.';
export const PAYWALL_RESUME_LABEL = 'Resume the tutorial on the sample job';

/** A run that must not be ended by a wall met mid-run. A restored run is not
 *  one: nothing is teaching him and it holds no pass (see header). */
export function runBlocksPaywallOffer(s: RunState): boolean {
  return s.status === 'running' && !(s.paused && s.paused.reason === 'restored');
}

/** The tutorial of a restored (inert, pass-less) run, else null. */
export function restoredRunId(s: RunState): TutorialId | null {
  return s.status === 'running' && s.paused && s.paused.reason === 'restored' ? s.tutorialId : null;
}

export function paywallPracticeOffer(a: {
  tutorialId: TutorialId | null | undefined;
  progress: TutorialProgress | null | undefined;
  progressLoaded: boolean;
  runActive: boolean;
  /** restoredRunId(state): when it is THIS tutorial, the offer resumes it. */
  restoredTutorialId?: TutorialId | null;
  passOn?: boolean;
  defs?: TutorialDefs;
}): PaywallPracticeOffer | null {
  const passOn = a.passOn ?? TUTORIAL_PRACTICE_PASS;
  const defs = a.defs ?? TUTORIAL_DEFS;
  if (!passOn || !a.tutorialId || a.runActive || !a.progressLoaded || !a.progress) return null;
  const def = defs[a.tutorialId];
  if (!def || def.sandbox === 'current-real' || def.practiceFeatures.length === 0) return null;
  if (a.progress.byId[a.tutorialId]?.status === 'practised') return null;
  return {
    tutorialId: a.tutorialId,
    label: a.restoredTutorialId === a.tutorialId
      ? PAYWALL_RESUME_LABEL
      : `Try it free on a sample job first · ${durationLabel(def)}`,
    sub: PAYWALL_PRACTICE_SUB,
  };
}
