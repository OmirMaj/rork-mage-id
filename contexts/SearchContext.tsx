// ============================================================================
// contexts/SearchContext.tsx
//
// The MAGE Brain surface state. Wraps the Universal Search modal's visibility
// AND the two secondary Brain actions (voice capture, help) that the search
// surface fans out to. Lives above the router stack so Cmd+K, the home-header
// search button, and the Brain FAB can all reach it. The <BrainSurface /> mount
// (search + FAB + the hidden voice/help triggers) lives in app/_layout.
//
// Voice + Help are fired by an incrementing signal — the actual
// <UniversalMicButton /> and <HelpFab /> mount once globally in BrainSurface
// with `hideFab`, and open their own modals when the signal bumps. This is the
// same trigger pattern the old HomeFabStack used; it's now global so the ONE
// Brain FAB can offer voice + help on every screen, not just home.
// ============================================================================

import { useCallback, useState } from 'react';
import createContextHook from '@nkzw/create-context-hook';

export const [SearchProvider, useSearch] = createContextHook(() => {
  const [isOpen, setIsOpen] = useState(false);
  const [voiceSignal, setVoiceSignal] = useState(0);
  const [helpSignal, setHelpSignal] = useState(0);

  const openSearch = useCallback(() => setIsOpen(true), []);
  const closeSearch = useCallback(() => setIsOpen(false), []);
  const toggleSearch = useCallback(() => setIsOpen(prev => !prev), []);

  // Close the search surface first, then fire the secondary action, so the
  // voice/help modal opens onto a clean screen rather than over the search list.
  const openVoice = useCallback(() => { setIsOpen(false); setVoiceSignal(n => n + 1); }, []);
  const openHelp = useCallback(() => { setIsOpen(false); setHelpSignal(n => n + 1); }, []);

  return { isOpen, openSearch, closeSearch, toggleSearch, voiceSignal, helpSignal, openVoice, openHelp };
});
