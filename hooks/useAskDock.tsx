// hooks/useAskDock.tsx — open Ask MAGE in the desktop shell's right dock.
//
// WHY (wave 6d restore, d6r lane K1). Ask MAGE was a full-window page on the
// laptop, so the founder could not look at the schedule while asking about
// it — the whole point of asking. On desktop web the Brain FAB, Cmd+J and the
// sidebar's Ask MAGE row now dock the conversation (components/brain/
// AskConversation variant 'panel') in components/desktop/ShellDock, beside
// whatever page he is on.
//
// Where the dock cannot show — not desktop web, no shell host, a
// shell-exempt route (/copilot, /brief, the wizards, the paywall), or /ask
// itself (which suppresses the Ask dock) — openAsk falls back to today's /ask
// page with the same params the page reads, so the tap is never dead. On /ask
// it does nothing: the page IS Ask.
//
//   const { openAsk, toggleAsk, isAskOpen } = useAskDock();
//   openAsk({ screen: 'rfi', projectId });     // dock (or the page)
//   openAsk({ seed: 'What is late on Henderson?' });  // a fresh, seeded chat
//   openAsk({ fresh: true });                   // 'New chat'

import React, { useCallback, useMemo, useRef } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { ASK_DOCK_ID, useShellDock } from '@/components/desktop/ShellDock';
import { AskConversation } from '@/components/brain/AskConversation';
import { SIDE_PANEL_DEFAULT } from '@/utils/splitViewLayout';

export interface OpenAskOptions {
  /** The job to anchor to — the page reads it; the dock follows the active job. */
  projectId?: string;
  /** The screen Ask is opened from (tunes the starters). */
  screen?: string;
  /** A question to ask as soon as the conversation opens. */
  seed?: string;
  /** Start a new conversation even when Ask is already docked. */
  fresh?: boolean;
}

export interface AskDock {
  openAsk(opts?: OpenAskOptions): void;
  toggleAsk(): void;
  /** Ask is docked AND on screen right now. */
  isAskOpen: boolean;
}

/** Each docked conversation gets its own key: a new chat (or a seeded one) is
 *  a new AskConversation instance — a fresh session id and empty turns — not
 *  the old one re-rendered with new props. The old thread is already saved in
 *  askHistory (the Recent list). */
let askSeq = 0;

export function useAskDock(): AskDock {
  const router = useRouter();
  const segments = useSegments();
  const isDesktopWeb = useIsDesktopWeb();
  const dock = useShellDock();
  const onAskPage = (segments[0] as string | undefined) === 'ask';

  // The docked panel's 'New chat' calls back through this ref, so the panel
  // node built below never captures a stale openAsk.
  const openAskRef = useRef<(opts?: OpenAskOptions) => void>(() => {});
  const openAsk = useCallback((opts?: OpenAskOptions) => {
    if (onAskPage) return; // the page IS Ask
    if (!isDesktopWeb || !dock.canShow(ASK_DOCK_ID)) {
      // Today's page, with only the params that carry a value (expo-router
      // would otherwise write `?seed=undefined` into the URL).
      const params: { projectId?: string; screen?: string; seed?: string } = {};
      if (opts?.projectId) params.projectId = opts.projectId;
      if (opts?.screen) params.screen = opts.screen;
      if (opts?.seed) params.seed = opts.seed;
      router.push({ pathname: '/ask', params });
      return;
    }
    if (dock.id === ASK_DOCK_ID && !opts?.seed && !opts?.fresh) {
      dock.show();
      return;
    }
    askSeq += 1;
    dock.open(
      <AskConversation
        key={`ask-${askSeq}`}
        variant="panel"
        seed={opts?.seed}
        screen={opts?.screen}
        onNewChat={() => openAskRef.current({ fresh: true })}
      />,
      { id: ASK_DOCK_ID, title: 'Ask MAGE', width: SIDE_PANEL_DEFAULT },
    );
  }, [onAskPage, isDesktopWeb, dock, router]);
  openAskRef.current = openAsk;

  const toggleAsk = useCallback(() => {
    if (dock.id === ASK_DOCK_ID && dock.canShow(ASK_DOCK_ID)) dock.toggle();
    else openAsk();
  }, [dock, openAsk]);

  const isAskOpen = dock.showing && dock.id === ASK_DOCK_ID;

  return useMemo(() => ({ openAsk, toggleAsk, isAskOpen }), [openAsk, toggleAsk, isAskOpen]);
}
