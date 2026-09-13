// components/brain/BrainSurface.tsx
//
// The ONE MAGE Brain entry, composed. Mounted once in app/_layout, present on
// every screen. It is the single replacement for the old scattered AI doors:
// the per-screen AICopilot FABs and the home-only HomeFabStack.
//
//   • BrainFab        — the floating button (bottom-right, every screen)
//   • UniversalSearch — the surface it opens: search + the Ask / Voice / Help
//                       quick actions
//   • UniversalMicButton / HelpFab — mounted hidden (no FAB of their own) and
//                       fired by the Brain surface's Voice / Help actions via an
//                       incrementing signal from SearchContext.
//
// Because voice + help now live at the Brain surface globally, they're one tap
// from anywhere — not just the home screen, as before.

import React, { useState, useCallback } from 'react';
import UniversalSearch from '@/components/UniversalSearch';
import Tutorial from '@/components/Tutorial';
import UniversalMicButton from '@/components/UniversalMicButton';
import { HelpFab } from '@/components/HelpFab';
import { BrainFab } from '@/components/brain/BrainFab';
import { useSearch } from '@/contexts/SearchContext';

export function BrainSurface() {
  const { voiceSignal, helpSignal } = useSearch();
  // HelpFab renders its "Replay the tutorial" row only when it is given a
  // handler (components/HelpFab.tsx:144). This mount — the app-wide one — was
  // passing none, so the 988-line interactive Tutorial had exactly one door in
  // the whole product: a row buried in a ~1800-line settings screen. Owning the
  // modal here is what HelpFab's `onReplayTutorial` was designed for; its own
  // comment says the parent should hold the visible state rather than have the
  // FAB reach into it (audit 2026-09-07, built-but-unreachable #5).
  const [showTutorial, setShowTutorial] = useState(false);
  const openTutorial = useCallback(() => setShowTutorial(true), []);
  const closeTutorial = useCallback(() => setShowTutorial(false), []);
  return (
    <>
      <UniversalSearch />
      <BrainFab />
      <UniversalMicButton hideFab openSignal={voiceSignal} />
      <HelpFab hideFab openSignal={helpSignal} onReplayTutorial={openTutorial} />
      <Tutorial visible={showTutorial} onClose={closeTutorial} />
    </>
  );
}

export default BrainSurface;
