// onboardingProfile — captures the one routing question we ask during
// onboarding ("how big is the job you're running?") so downstream
// surfaces (home, estimator defaults, AI prompts) can personalize.
//
// Per the 2026 onboarding research: a single routing question reshapes
// downstream experience more than any other lever (HubSpot data). We
// resist the urge to ask 5 questions; one is the right number.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY = 'mage_onboarding_profile_v1';

/** Which side of the marketplace the user is here for. Drives the entire
 * tab bar + home dashboard + paywall gating downstream. Mirrored to
 * `public.profiles.user_role` server-side; this AsyncStorage copy is the
 * fast-path read used by the root layout's routing gate so cold boot
 * doesn't flash the wrong tab bar while the Supabase query hydrates. */
export type UserRole = 'contractor' | 'client' | 'both';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  contractor: 'Contractor',
  client: 'Property Owner',
  both: 'Both',
};

export const USER_ROLE_BLURB: Record<UserRole, string> = {
  contractor: 'Estimates, schedules, daily reports, AIA pay apps, AI takeoffs — the operating system for builders.',
  client: 'Post a project, get bids from vetted contractors, pick one, and track the work without managing the site.',
  both: 'Switch between contractor mode and property-owner mode any time. We default you to contractor.',
};

/** Project-size band the user told us they typically run. Drives:
 *   - estimate wizard defaults (markup %, contingency, line-item depth)
 *   - which sample project to seed if they pick "Try a sample"
 *   - AI prompt context ("they run $1-5M residential jobs") */
export type ProjectSizeBand = 'under_1m' | '1_to_5m' | '5_to_15m' | 'over_15m';

export const SIZE_BAND_LABELS: Record<ProjectSizeBand, string> = {
  under_1m: 'Under $1M',
  '1_to_5m': '$1–5M',
  '5_to_15m': '$5–15M',
  over_15m: '$15M+',
};

/** Plain-English description used by AI Copilot context + analytics. */
export const SIZE_BAND_PERSONA: Record<ProjectSizeBand, string> = {
  under_1m: 'small remodel / single-trade focus — kitchens, baths, ADUs',
  '1_to_5m': 'mid-residential GC — full additions, large remodels, custom homes',
  '5_to_15m': 'high-end residential / light commercial — luxury custom, multi-unit',
  over_15m: 'mid-market commercial / multifamily — mixed-use, condo developments',
};

export interface OnboardingProfile {
  /** When the user completed onboarding. */
  completedAt: string;
  /** What size project they said they run. */
  sizeBand?: ProjectSizeBand;
}

// NOTE: `userRole` is intentionally NOT stored on this profile blob — it
// lives in its own AsyncStorage key (`buildwise_user_role`) and on
// `public.profiles.user_role`. Keeping them separate so changing persona
// later doesn't require rewriting / re-validating the entire onboarding
// state, and so we can read role on cold boot without parsing JSON.

export async function loadOnboardingProfile(): Promise<OnboardingProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OnboardingProfile;
  } catch {
    return null;
  }
}

export async function saveOnboardingProfile(profile: OnboardingProfile): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(profile));
  } catch {/* ignore */}
}

/** React hook — returns the profile + a setter that persists. */
export function useOnboardingProfile(): {
  profile: OnboardingProfile | null;
  setSizeBand: (band: ProjectSizeBand) => Promise<void>;
} {
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadOnboardingProfile().then(p => { if (!cancelled) setProfile(p); });
    return () => { cancelled = true; };
  }, []);
  const setSizeBand = async (band: ProjectSizeBand) => {
    const next: OnboardingProfile = {
      completedAt: profile?.completedAt ?? new Date().toISOString(),
      sizeBand: band,
    };
    await saveOnboardingProfile(next);
    setProfile(next);
  };
  return { profile, setSizeBand };
}

/** Map user's size band → which DemoSeedPickerModal flavor to default to. */
export function suggestedDemoFlavorForBand(band: ProjectSizeBand | undefined): 'small' | 'medium' | 'large' {
  switch (band) {
    case 'under_1m': return 'small';
    case '1_to_5m': return 'medium';
    case '5_to_15m':
    case 'over_15m':
      return 'large';
    default:
      return 'medium';
  }
}
