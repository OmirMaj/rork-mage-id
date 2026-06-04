// PostHog analytics transport — the OTA-safe HTTP provider that lights up
// every track() call across the app (paywall, login, onboarding import, …).
//
// Why HTTP and not the posthog-react-native SDK: the SDK is a native module
// (new build, Fabric/TurboModule review per CLAUDE.md). The capture REST
// endpoint needs no native code, so this ships over OTA and works on web,
// iOS, and Android identically. We trade autocapture / session replay for
// zero-dependency, OTA-shippable event capture — which is all the explicit
// track() calls need.
//
// The ingestion token is PUBLIC by design: it can only *write* events, never
// read project data — same posture as the Supabase anon key. Embedding it in
// the JS bundle is expected. Override per-environment with EXPO_PUBLIC_*.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { setAnalyticsProvider } from './analytics';
import { generateUUID } from './generateId';

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY || 'phc_t7H39GTePH8rLhBb567TNYHV6WHbVpmK7Yj6q4iGR7hZ';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

// Persisted so a returning anonymous user keeps the same identity across
// cold starts (and so pre-login onboarding events stitch to the person once
// they identify).
const DISTINCT_ID_KEY = 'mage_analytics_distinct_id';

let distinctId: string | null = null;
let initialized = false;

async function loadDistinctId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DISTINCT_ID_KEY);
    if (existing) return existing;
  } catch {
    // AsyncStorage unavailable — fall through to an in-memory id.
  }
  const fresh = generateUUID();
  try { await AsyncStorage.setItem(DISTINCT_ID_KEY, fresh); } catch { /* best effort */ }
  return fresh;
}

// Fire-and-forget POST to PostHog's capture endpoint. Analytics must never
// block the UI or throw into the app, so every failure path is swallowed.
function send(event: string, properties?: Record<string, unknown>, overrideDistinctId?: string): void {
  const id = overrideDistinctId ?? distinctId;
  if (!POSTHOG_KEY || !id) return;
  void fetch(`${POSTHOG_HOST}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: POSTHOG_KEY,
      event,
      distinct_id: id,
      properties: {
        ...properties,
        $lib: 'mage-id',
        $os: Platform.OS,
      },
      timestamp: new Date().toISOString(),
    }),
  }).catch(() => { /* never surface analytics transport errors */ });
}

// Register the HTTP provider in place of the default console provider. Safe
// to call more than once; only the first call wires anything up.
export async function initAnalytics(): Promise<void> {
  if (initialized) return;
  initialized = true;
  distinctId = await loadDistinctId();
  setAnalyticsProvider({
    track: (eventName, props) => send(eventName, props),
  });
}

// Tie subsequent events to the authenticated user, merging the prior
// anonymous identity so pre-login events stitch to the same person.
export async function identifyAnalyticsUser(userId: string): Promise<void> {
  if (!userId || userId === distinctId) return;
  const anonId = distinctId;
  if (anonId) send('$identify', { $anon_distinct_id: anonId }, userId);
  distinctId = userId;
  try { await AsyncStorage.setItem(DISTINCT_ID_KEY, userId); } catch { /* best effort */ }
}

// On logout, sever the link so the next account on the device isn't merged
// into the previous person.
export async function resetAnalyticsUser(): Promise<void> {
  const fresh = generateUUID();
  distinctId = fresh;
  try { await AsyncStorage.setItem(DISTINCT_ID_KEY, fresh); } catch { /* best effort */ }
}
