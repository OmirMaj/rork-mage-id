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

/** What the last openVoice() asked for. `projectId` files the note to that
 *  project (the mic still lets the user change it); `autoStart` begins
 *  recording as soon as the capture sheet is visible (native only — the web
 *  mic is disabled, so autoStart is a no-op there). */
export interface VoiceRequest {
  projectId?: string;
  autoStart: boolean;
}

export interface OpenVoiceOptions {
  projectId?: string;
  autoStart?: boolean;
}

const EMPTY_VOICE_REQUEST: VoiceRequest = { autoStart: false };

export const [SearchProvider, useSearch] = createContextHook(() => {
  const [isOpen, setIsOpen] = useState(false);
  const [voiceSignal, setVoiceSignal] = useState(0);
  const [helpSignal, setHelpSignal] = useState(0);
  const [voiceRequest, setVoiceRequest] = useState<VoiceRequest>(EMPTY_VOICE_REQUEST);

  const openSearch = useCallback(() => setIsOpen(true), []);
  const closeSearch = useCallback(() => setIsOpen(false), []);
  const toggleSearch = useCallback(() => setIsOpen(prev => !prev), []);

  // Close the search surface first, then fire the secondary action, so the
  // voice/help modal opens onto a clean screen rather than over the search list.
  // openVoice() with no argument behaves exactly as before (no project hint,
  // no auto-start). Guard against being wired straight to onPress, which would
  // hand us a press event instead of options.
  const openVoice = useCallback((opts?: OpenVoiceOptions) => {
    const o = opts && typeof opts === 'object' && !('nativeEvent' in opts) ? opts : undefined;
    setIsOpen(false);
    setVoiceRequest({
      projectId: typeof o?.projectId === 'string' && o.projectId ? o.projectId : undefined,
      autoStart: o?.autoStart === true,
    });
    setVoiceSignal(n => n + 1);
  }, []);
  // The mic clears the request when it closes, so the next open re-resolves.
  const clearVoiceRequest = useCallback(() => setVoiceRequest(EMPTY_VOICE_REQUEST), []);
  const openHelp = useCallback(() => { setIsOpen(false); setHelpSignal(n => n + 1); }, []);

  return { isOpen, openSearch, closeSearch, toggleSearch, voiceSignal, voiceRequest, clearVoiceRequest, helpSignal, openVoice, openHelp };
});
