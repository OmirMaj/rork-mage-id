// onboardingProgress — first-time milestone tracking for the home-screen
// onboarding checklist. Each milestone is a one-shot AsyncStorage flag
// so we can show a "you've used voice already" check without inspecting
// every transcript or every takeoff result.
//
// Counts vs flags: project / estimate / invoice come from real state
// (ProjectContext + InvoiceContext) so they never lie. Takeoff and voice
// don't have a clean count source — there's no "voice usage log" — so
// we record a single boolean per milestone here.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export const ONBOARDING_FIRST_TAKEOFF_KEY = 'mageid_milestone_first_takeoff_v1';
export const ONBOARDING_FIRST_VOICE_KEY = 'mageid_milestone_first_voice_v1';

/** Mark a milestone as done. Idempotent — safe to call from anywhere. */
async function markMilestone(key: string): Promise<void> {
  try { await AsyncStorage.setItem(key, '1'); } catch {}
}

export function markFirstTakeoffDone(): Promise<void> {
  return markMilestone(ONBOARDING_FIRST_TAKEOFF_KEY);
}

export function markFirstVoiceUsed(): Promise<void> {
  return markMilestone(ONBOARDING_FIRST_VOICE_KEY);
}

async function readMilestone(key: string): Promise<boolean> {
  try { return (await AsyncStorage.getItem(key)) === '1'; }
  catch { return false; }
}

/**
 * React hook that reads both milestones once on mount + whenever
 * `refreshKey` changes. Pass any state value as `refreshKey` to force a
 * re-read after you call markFirstTakeoffDone / markFirstVoiceUsed.
 */
export function useOnboardingMilestones(refreshKey: unknown = null): {
  takeoffRun: boolean;
  voiceUsed: boolean;
} {
  const [state, setState] = useState({ takeoffRun: false, voiceUsed: false });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [t, v] = await Promise.all([
        readMilestone(ONBOARDING_FIRST_TAKEOFF_KEY),
        readMilestone(ONBOARDING_FIRST_VOICE_KEY),
      ]);
      if (!cancelled) setState({ takeoffRun: t, voiceUsed: v });
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);
  return state;
}
