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

import React from 'react';
import UniversalSearch from '@/components/UniversalSearch';
import UniversalMicButton from '@/components/UniversalMicButton';
import { HelpFab } from '@/components/HelpFab';
import { BrainFab } from '@/components/brain/BrainFab';
import { useSearch } from '@/contexts/SearchContext';

export function BrainSurface() {
  const { voiceSignal, helpSignal } = useSearch();
  return (
    <>
      <UniversalSearch />
      <BrainFab />
      <UniversalMicButton hideFab openSignal={voiceSignal} />
      <HelpFab hideFab openSignal={helpSignal} />
    </>
  );
}

export default BrainSurface;
