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

import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import UniversalSearch from '@/components/UniversalSearch';
import UniversalMicButton from '@/components/UniversalMicButton';
import { HelpFab } from '@/components/HelpFab';
import { BrainFab } from '@/components/brain/BrainFab';
import { useSearch } from '@/contexts/SearchContext';
import { useCoreData } from '@/contexts/ProjectContext';
import { helpTutorialsRowVisible } from '@/utils/tutorial/entryPoints';

export function BrainSurface() {
  const { voiceSignal, helpSignal } = useSearch();
  const router = useRouter();
  // The narrow core slice, not useProjects(): this surface is always mounted,
  // and the full hook re-rendered it (and UniversalSearch, the FAB and the mic)
  // on every financial / field / docs change across the app.
  const { userRole } = useCoreData();
  // The Help sheet's Tutorials row opens the /tutorials hub — learn-by-doing
  // coach marks over the real screens on a sample job. It replaced the
  // 1,012-line mock slideshow this surface used to mount as a modal (the old
  // components/Tutorial.tsx, retired with the hub). HelpFab draws the row only
  // when handed a handler, so a client or property-manager persona — who has
  // nothing to practise — gets no handler and no row.
  const openTutorials = useCallback(() => router.push('/tutorials'), [router]);
  return (
    <>
      <UniversalSearch />
      <BrainFab />
      <UniversalMicButton hideFab openSignal={voiceSignal} />
      <HelpFab
        hideFab
        openSignal={helpSignal}
        onOpenTutorials={helpTutorialsRowVisible(userRole) ? openTutorials : undefined}
      />
    </>
  );
}

export default BrainSurface;
