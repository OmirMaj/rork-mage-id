// utils/tutorial/activeRun.ts — the id of the live tutorial run, as a bare
// module variable.
//
// WHY ITS OWN FILE WITH NO IMPORTS. utils/analytics.ts merges
// {in_tutorial: true, tutorial_id} into every event during a run, so the
// Activation funnel can tell practice from real use. analytics is imported by
// nearly everything, including the tutorial store; if it imported the store
// (or anything that reaches ProjectContext) it would close an import cycle.
// This file imports nothing, so anyone can read it. utils/tutorial/store.ts
// is the only writer.

let activeTutorialId: string | null = null;

export function getActiveTutorialId(): string | null {
  return activeTutorialId;
}

/** Store-only. Pass null when the run ends (finished or exited). */
export function setActiveTutorialId(id: string | null): void {
  activeTutorialId = id;
}
