// app/ask.tsx — "Ask MAGE anything", powered by One Mind.
//
// One question in, one fused answer out, with every cited fact block a
// tappable chip that drills into the real screen behind it. The conversation
// itself — bundle assembly, metering (askMage), the citation chips, the
// anchored job, the Recent strip — lives in components/brain/AskConversation,
// which renders it either as this full page or inside the desktop shell's
// 440 px right dock (hooks/useAskDock), so the GC can keep the schedule on
// screen while he asks about it (wave 6d restore, d6r lane K1).
//
// This route is the page variant and only reads the URL:
//   ?projectId=  the job the Brain FAB forwarded from a job screen — the
//                conversation is ANCHORED to it ("Answering for <job>", tap to
//                clear; audit #36);
//   ?screen=     the screen Ask was opened from — tunes the starters;
//   ?seed=       a question the Copilot hub hands over, auto-asked once the
//                project data has hydrated.
//
// On desktop web the Brain FAB, Cmd+J and the sidebar's Ask MAGE row open the
// dock instead; this page is what a direct /ask link (and a phone) gets.

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { AskConversation } from '@/components/brain/AskConversation';

export default function AskMageScreen() {
  const { seed, screen, projectId } =
    useLocalSearchParams<{ seed?: string; screen?: string; projectId?: string }>();
  return (
    <AskConversation
      variant="page"
      seed={seed}
      screen={screen}
      anchorProjectId={projectId ?? null}
    />
  );
}
