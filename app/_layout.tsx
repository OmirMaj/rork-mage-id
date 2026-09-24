import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments, usePathname, useGlobalSearchParams } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Fraunces_500Medium, Fraunces_700Bold, Fraunces_700Bold_Italic } from "@expo-google-fonts/fraunces";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, View, LogBox, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BrandSplash from "@/components/BrandSplash";
import CraneLoader from "@/components/CraneLoader";
import DesktopSidebar from "@/components/DesktopSidebar";
import { useResponsiveLayout } from "@/utils/useResponsiveLayout";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProjectProvider, useProjects, useProjectActions } from "@/contexts/ProjectContext";
import { ActiveProjectProvider } from "@/contexts/ActiveProjectContext";
import { SafetyProvider } from "@/contexts/SafetyContext";
import { CrewProvider } from "@/contexts/CrewContext";
import { useClaimedCrewProfile } from "@/hooks/useClaimedCrewProfile";
import { TimeEntriesProvider } from "@/contexts/TimeEntriesContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { MaterialCartProvider } from "@/contexts/MaterialCartContext";
import { PropertyProvider } from "@/contexts/PropertyContext";
import { WipProvider } from "@/contexts/WipContext";
import { ScanProvider } from "@/contexts/ScanContext";
import { BidsProvider } from "@/contexts/BidsContext";
import { CompaniesProvider } from "@/contexts/CompaniesContext";
import { HireProvider } from "@/contexts/HireContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { SearchProvider, useSearch } from "@/contexts/SearchContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { BrainSurface } from "@/components/brain/BrainSurface";
import { TutorialHost } from "@/components/tutorial/TutorialHost";
import { useBrainFabPresentation } from "@/components/brain/brainFabState";
import OfflineSyncPill from "@/components/OfflineSyncPill";
import { NailItToastHost } from "@/components/animations/NailItToast";
import AlertHost from "@/components/AlertHost";
import { useQuickActionRouting } from "expo-quick-actions/router";
import { ConfettiHost } from "@/components/animations/Confetti";
import { Colors, setCustomPrimary, legacyChrome } from "@/constants/colors";
import { THEME_PRESETS } from "@/types";
import ErrorBoundary from "@/components/ErrorBoundary";
import MarginAlertManager from "@/components/MarginAlertManager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { processOfflineQueue, onQueueChanged } from "@/utils/offlineQueue";
import { processPhotoUploadQueue } from "@/utils/photoUploadQueue";
import { initAnalytics, identifyAnalyticsUser, resetAnalyticsUser } from "@/utils/posthog";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import * as Sentry from '@sentry/react-native';
import { setPendingDeepLink, takePendingDeepLink } from '@/utils/pendingDeepLink';
import { pathToDocumentTitle } from '@/utils/routeTitle';
import { AutonomyProvider } from '@/hooks/useAutonomy';
import { PUBLIC_PATHS } from '@/utils/deepLinkScheme';
import {
  INVITE_PARAM, sanitizeInviteToken, markInviteTokenHandled, metadataInviteRedirect,
  rootNavPresentation, ROOT_NAV_INITIAL, type RootNavState,
} from '@/utils/deepLinksInvite';
import { isTransportError } from '@/utils/networkErrors';
import { parseSignupIntent, persistSignupIntent } from '@/utils/signupIntent';
import { NATIVE_HEADER_TITLE_FACE, nativeHeaderOptions } from '@/constants/navigation';
import {
  ThemeProvider as NavThemeProvider, DefaultTheme, DarkTheme, type Theme as NavTheme,
} from '@react-navigation/native';
import { DESKTOP_SHELL_EXEMPT } from '@/utils/desktopPage';
import { renderDesktopPageFrame } from '@/components/desktop/DesktopPageFrame';
import { ShellDockProvider, ShellDockHost } from '@/components/desktop/ShellDock';

// NOTE: the old patchAlertForWeb() monkey-patch is gone. Every call site now
// goes through utils/alert.ts showAlert/showPrompt, which renders a real
// themed modal on web (<AlertHost/> below) instead of window.confirm — and
// unlike the patch it supports 3 buttons and prompts.

// Silence LogBox's on-screen notification toasts in dev (e.g. the RevenueCat
// "Error fetching offerings" sim-only network warning, and the "Open debugger
// to view warnings" summary). They're dev-only — never present in a release
// build — but they overlay the bottom of the UI and ruin marketing/App-Store
// screenshots taken from the simulator. Errors still surface in the debugger;
// this only hides the overlay. No effect in production.
if (__DEV__) {
  LogBox.ignoreAllLogs();
}

// UX-F18 — deliberately NO `unstable_settings = { initialRouteName: '(tabs)' }`
// here. Expo Router 6 honours it (getRoutesCore.js reads `anchor ??
// initialRouteName`) and it would give a cold-start deep link a parent for Back,
// but it mounts the tab shell BENEATH every deep-linked route, and /week-close
// then never settles: WeekCloseCard's useFocusEffect + a second useWeekClose sit
// under the screen that stamps WEEK_CLOSE_LAST_SEEN_KEY on mount, and the smoke
// harness hangs past 120 s on that one route (passes in ~3 s without the anchor;
// A/B'd 2026-09-04, both with and without the ProjectContext changes). Cold-start
// Back is instead handled per-screen by hooks/useSafeBack.ts (canGoBack() ?
// back() : replace('/(tabs)/(home)')). Re-add the anchor only after /week-close
// and the home card stop reacting to each other.


// Native header chrome is built per render inside RootLayoutNav (wave 6b):
// the old module-level NATIVE_HEADER_TITLE froze `Colors.text` to the light
// theme's black at module load, so dark mode got a black title on a dark bar.
// See constants/navigation.ts nativeHeaderOptions and constants/colors.ts
// legacyChrome.
//
// DESKTOP_SHELL_EXEMPT (the routes that never show the desktop sidebar) moved
// to utils/desktopPage.ts in wave 6b, next to the route → page-width map the
// root Stack's DesktopPageFrame reads, so the shell, the sync pill and the
// page frame agree on one list.

Sentry.init({
  dsn: 'https://f1ef45279647b4001040c1e2f9407faa@o4511315578388480.ingest.us.sentry.io/4511315581075456',

  // Don't send dev crashes — they pollute the dashboard and burn the
  // free-tier quota. Only production builds report.
  enabled: !__DEV__,

  // Tag every event with the build environment so you can filter
  // production-only in the dashboard (saved view: environment:production).
  environment: __DEV__ ? 'dev' : 'production',

  // Performance trace sampling — 10% catches enough to spot slow paths
  // without flooding the project. Bump to 0.25 if you ever need more.
  tracesSampleRate: 0.1,

  // sendDefaultPii forwards IPs, cookies, User-Agents to Sentry. For
  // GDPR/CCPA users that's a privacy-policy disclosure we don't yet
  // make, so disabled until the policy is updated to cover it. Crash
  // reports + replays still work — they just don't carry IP / UA.
  sendDefaultPii: false,

  // enableLogs forwards console.log + console.warn to Sentry as
  // breadcrumbs. The codebase has lots of [Auth] / [RC] /
  // [Subscription] logs that include emails and tokens; without
  // sanitization those would leak into Sentry. Disabled until we
  // do a full PII pass on those callsites.
  enableLogs: false,

  // Configure Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // #126 (CONTRACT 15): a read that never reached the server is not
      // retried — the device is offline, and two more tries only hold the
      // screen on its loader for the retry window before the same error.
      // This used to match only the browser's exact 'Failed to fetch', which
      // React Native never produces ('Network request failed'), so on iPhone
      // every offline read retried twice. isTransportError is the one shared
      // definition (offlineQueue and useProjectRole read the same one); a
      // server answer — an RLS refusal, a 57014 statement timeout — still gets
      // its two retries.
      retry: (failureCount, error) => {
        if (isTransportError(error)) return false;
        return failureCount < 2;
      },
      staleTime: 5 * 60 * 1000,
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});

// Magic-link handler — listens for incoming deep links that contain
// Supabase auth tokens (the URL the user taps from their inbox after
// requesting a magic link), then exchanges the tokens for a session.
// Runs at the root so it's mounted before any auth-gated screen.
function MagicLinkHandler() {
  const { onNewSessionEstablished, beginSessionFromToken } = useAuth();
  useEffect(() => {
    // Helper: pull access_token + refresh_token out of the URL hash
    // (Supabase puts them in `#access_token=...&refresh_token=...`).
    const tryRedeem = async (url: string | null): Promise<void> => {
      if (!url) return;
      try {
        const hashIdx = url.indexOf('#');
        if (hashIdx < 0) return;
        const fragment = url.slice(hashIdx + 1);
        const params = new URLSearchParams(fragment);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token') ?? '';
        const errorDesc = params.get('error_description') ?? params.get('error');
        if (errorDesc) {
          console.warn('[MagicLink] error in URL:', errorDesc);
          return;
        }
        if (!accessToken) return;
        // SYNC-F13: the token's claims name the arriving account. When it is
        // not the last user on this device, the previous tenant's pending
        // writes are flushed under THEIR still-active session and their
        // caches wiped BEFORE the session switches — the same order the
        // password/OAuth paths use. Wiping only after setSession let the new
        // user's first queries merge the previous tenant's local rows.
        const handoff = await beginSessionFromToken(accessToken);
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          console.warn('[MagicLink] setSession failed:', error.message);
        } else {
          console.log('[MagicLink] session set from magic link');
          // Run the same shared-device cache guard the password/OAuth
          // sign-in paths do. Magic-link & password-reset redemption set
          // the session directly here, bypassing login()/signup(), so
          // without this the previous user's cached projects/DFRs and
          // queued mutations would leak into the new user's session.
          await onNewSessionEstablished(handoff);
        }
      } catch (e) {
        console.warn('[MagicLink] redeem error:', e);
      }
    };

    // 1) Cold launch: app was opened by tapping a magic link.
    void Linking.getInitialURL().then(tryRedeem);

    // 2) Warm: app already running, user tapped a magic link from
    //    Mail / Safari / SMS.
    const sub = Linking.addEventListener('url', ({ url }) => {
      void tryRedeem(url);
    });
    return () => sub.remove();
  }, [onNewSessionEstablished, beginSessionFromToken]);
  return null;
}

// Boots the PostHog HTTP transport once on mount (so anonymous events are
// captured immediately), then keeps the analytics identity in lock-step with
// auth: identify on login (merging the prior anonymous person), reset on
// logout. Mounted inside AuthProvider so useAuth() is available.
function AnalyticsManager() {
  const { isAuthenticated, user } = useAuth();

  useEffect(() => { void initAnalytics(); }, []);

  useEffect(() => {
    if (isAuthenticated && user?.id) void identifyAnalyticsUser(user.id);
    else if (!isAuthenticated) void resetAnalyticsUser();
  }, [isAuthenticated, user?.id]);

  return null;
}

// Roots where the queue depth is not ours to show: tokenized viewers a CLIENT
// or a SUB is holding the phone for, and the pre-auth flow. Same list
// components/brain/BrainFab.tsx hides on, minus 'ask' — the Brain's own
// destination is still the GC's screen.
const SYNC_PILL_HIDDEN_ROOTS: ReadonlySet<string> = new Set([
  'shared-estimate', 'shared-photos', 'shared-schedule', 'shared-plan', 'client-view',
  'prequal-form', 'claim-crew',
  'login', 'signup', 'reset-password', 'onboarding', 'persona-select', 'onboarding-paywall',
]);

// The only surface in the app that can say "you have unsynced changes".
// It shipped mounted on exactly one screen — the home tab's header — while
// every field write (daily-report, punch-list, punch-walk, time-tracking,
// field-ticket) says "Saved." unconditionally the moment the mutation lands in
// the offline queue. A super who dictates a report in a basement is told it
// saved and finds out otherwise when the owner asks where it is
// (app-experience audit 2026-09-07, "built but unreachable" #2).
//
// Mounted globally here rather than in a shared header because there is no
// shared header: PageHeader is used by 3 screens, FeatureHeader by 11, and
// daily-report rolls its own with headerShown:false. Bottom-LEFT, in the same
// band as the Brain FAB and raised by the same `lift`, because that band is
// the one strip of every screen that already reserves space for a floating
// control (BRAIN_FAB_CLEARANCE). A top strip would land on the native header
// title and on NailItToast, which owns top: 64 app-wide.
//
// The pill renders null at queue depth 0, so the happy path costs nothing but
// one AsyncStorage read every 4s (hooks/useOfflineQueueDepth).

function GlobalOfflineSyncPill() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  // Deliberately reads the FAB's presentation store: `lift` is the height of
  // whatever fixed bottom bar the focused screen registered, so the pill
  // clears a sticky footer for exactly the screens the FAB already clears one
  // for. We do NOT honour `hidden` — the FAB slides away while you read, but a
  // "your work has not left this phone" signal must not.
  const { lift } = useBrainFabPresentation();
  const layout = useResponsiveLayout();
  const segments = useSegments();
  const pathname = usePathname();

  const topSegment = (segments[0] as string) ?? '';
  // The Brain FAB lives at right:20 and nothing occupies the right edge, so it
  // can position off the window. The LEFT 240pt is the DesktopSidebar's rail,
  // and this pill is touchable — unshifted it paints over and swallows taps on
  // the nav rows underneath. Mirrors RootLayoutNav's `showDesktopShell`
  // predicate (breakpoint + auth + shell-exempt route) so the two never
  // disagree about whether the rail is on screen.
  const railShowing =
    layout.showSidebar
    && isAuthenticated
    && !DESKTOP_SHELL_EXEMPT.has(topSegment)
    && !pathname.startsWith('/integrations/');

  if (!isAuthenticated) return null;
  if (SYNC_PILL_HIDDEN_ROOTS.has(topSegment)) return null;

  return (
    <View
      pointerEvents="box-none"
      // Hidden by the web print stylesheet (components/desktop/webDocument.ts):
      // a floating pill has no place on paper. Spread on web only, so the
      // native tree carries no new prop and stays identical to what ships.
      {...(Platform.OS === 'web' ? { nativeID: 'mage-sync-pill' } : null)}
      style={{
        position: 'absolute',
        left: 20 + (railShowing ? layout.sidebarWidth : 0),
        bottom: insets.bottom + 70 + lift + (Platform.OS === 'web' ? 48 : 0),
        zIndex: 40,
      }}
    >
      <OfflineSyncPill variant="full" floating />
    </View>
  );
}

function OfflineSyncManager() {
  const appState = useRef(AppState.currentState);
  const { isAuthenticated } = useAuth();
  // SYNC-F7: the provider's debounced project syncs, flushed on background.
  const { flushPendingProjectSyncs } = useProjectActions();
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffMs = useRef(0);
  const draining = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    // Capped exponential backoff for the connectivity-less reconnect story.
    // We have no NetInfo/expo-network event to tell us signal returned (adding
    // one is a native dep and would break OTA — see deploy note), so when a
    // flush leaves items queued we self-reschedule with growing delay. That
    // drains the queue automatically once the network comes back even if the
    // app never leaves the foreground.
    const BASE_DELAY = 5_000;       // first retry ~5s after a failed drain
    const MAX_DELAY = 5 * 60_000;   // cap at 5 min between attempts

    const clearRetry = () => {
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };

    const scheduleBackoff = (drain: () => void) => {
      backoffMs.current = backoffMs.current === 0
        ? BASE_DELAY
        : Math.min(backoffMs.current * 2, MAX_DELAY);
      console.log('[OfflineSync] Retrying queue drain in', backoffMs.current, 'ms');
      retryTimer.current = setTimeout(drain, backoffMs.current);
    };

    // reset=true is used by the "fresh" triggers (startup / foreground): it
    // clears the backoff so we retry promptly. The self-scheduled retries pass
    // reset=false so the delay keeps growing while we stay offline.
    const drain = (reset: boolean) => {
      if (cancelled) return;
      if (reset) backoffMs.current = 0;
      clearRetry();
      draining.current = true;
      // Photo bytes drain on the SAME triggers as text mutations (startup,
      // foreground, backoff) but on their own queue — see utils/photoUploadQueue.
      // Chained rather than raced so a jobsite's uplink isn't split between
      // multi-MB image bodies and the small writes that make the UI consistent.
      void processOfflineQueue().then(async (res) => {
        const photos = await processPhotoUploadQueue().catch((err) => {
          console.log('[OfflineSync] Failed to process photo queue:', err);
          return { uploaded: 0, failed: 0, remaining: 0, foreign: 0 };
        });
        // A3 (round 3): `remaining` is each queue's OWN-tenant count. Entries
        // another session left behind come back as `foreign` and must not
        // re-arm this backoff — they are the tenant switch's to drop, and no
        // number of retries under this JWT would ever send them.
        return { processed: res.processed, remaining: res.remaining + photos.remaining };
      }).then(({ processed, remaining }) => {
        draining.current = false;
        if (cancelled) return;
        if (processed > 0) {
          console.log('[OfflineSync] Processed', processed, 'queued mutations');
        }
        if (remaining > 0) {
          scheduleBackoff(() => drain(false));
        } else {
          backoffMs.current = 0;
        }
      }).catch((err) => {
        draining.current = false;
        console.log('[OfflineSync] Failed to process queue:', err);
        // An unexpected flush failure is treated like a non-empty queue: back
        // off and try again rather than silently giving up.
        if (!cancelled) scheduleBackoff(() => drain(false));
      });
    };

    drain(true);

    // A write that lands in the queue WHILE ONLINE (one network blip on a
    // direct write, or a project edit the ordered writer put behind an earlier
    // queued one) used to wait for the next foreground/background change: the
    // backoff above is armed only by a drain that left items, and nothing had
    // drained. Meanwhile every later edit of that project queued behind it and
    // other devices, the client portal and Schedule Pro (busy while its project
    // has queued writes) saw none of it. So a queue that gains entries with no
    // drain running and no retry armed gets one soon. The delay is fixed, not
    // the growing backoff: this is a fresh write, and if we are really offline
    // that drain leaves items and arms the backoff as usual. Changes the drain
    // itself makes are ignored (draining), so this cannot loop.
    const unsubscribeQueue = onQueueChanged((depth) => {
      if (cancelled || depth === 0 || draining.current || retryTimer.current) return;
      retryTimer.current = setTimeout(() => { retryTimer.current = null; drain(false); }, BASE_DELAY);
    });

    // SYNC-F7: on the way OUT of the foreground, fire every debounced project
    // sync and drain the queue. iOS freezes JS timers in the background and
    // may evict the app, so an 800 ms debounce that has not fired yet is an
    // edit that only this process knows about; the next launch's server-first
    // load would then overwrite it. Runs on `inactive` too (the state iOS
    // passes through first) so the writes start as early as possible.
    const flushOnBackground = (why: string) => {
      console.log('[OfflineSync] App', why, '— flushing pending syncs + queue');
      void flushPendingProjectSyncs()
        .then(() => processOfflineQueue())
        .catch((err) => console.log('[OfflineSync] Background flush failed:', err));
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      // Compared, not `.match`ed. `AppState.currentState` is seeded from a
      // native constant and is NOT guaranteed to be a string — it is null on
      // Android before the first event, and it is a non-string under the jest
      // harness. `appState.current.match(...)` then throws inside this
      // listener, which is the ONE place the app learns it was foregrounded:
      // the offline queue would never drain on resume and the throw would
      // escape into RN's event emitter. Reproduced by
      // __tests__/smoke/foreground-permission.test.tsx.
      const previous = appState.current;
      if ((previous === 'inactive' || previous === 'background') && nextState === 'active') {
        console.log('[OfflineSync] App foregrounded, processing queue');
        drain(true);
      } else if (nextState === 'background' || nextState === 'inactive') {
        flushOnBackground(nextState);
      }
      appState.current = nextState;
    });

    // Web has no AppState transition for a closing tab; `pagehide` is the last
    // reliable signal before the page is torn down or frozen (bfcache).
    const onPageHide = () => flushOnBackground('pagehide');
    const hasWindow = Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.addEventListener === 'function';
    if (hasWindow) window.addEventListener('pagehide', onPageHide);

    return () => {
      cancelled = true;
      clearRetry();
      unsubscribeQueue();
      subscription.remove();
      if (hasWindow) window.removeEventListener('pagehide', onPageHide);
    };
  }, [isAuthenticated, flushPendingProjectSyncs]);

  return null;
}

/**
 * The query string to stash alongside a bounced path. On web it is the URL's
 * own `search`, exactly as typed or pasted. Elsewhere it is rebuilt from the
 * router's global params, minus the ones that fill a dynamic segment
 * (`[id]`), which are already inside `pathname`.
 */
function pendingLinkQuery(segments: string[], params: Record<string, string | string[] | undefined>): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.search ?? '';
  const dynamic = new Set(
    segments.map(seg => seg.match(/^\[(?:\.\.\.)?([^\]]+)\]$/)?.[1]).filter((k): k is string => !!k),
  );
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (dynamic.has(k) || v == null) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

function RootLayoutNav() {
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  // usePathname() carries NO query string, so the pending-link stash below
  // used to save `/invoice` from `/invoice?projectId=…&invoiceId=…` and the
  // replay landed a teammate on an empty editor. The row menu's "Copy link"
  // now hands out https links on the web-app origin whose record lives
  // entirely in the query (audit round 2 #34), so the stash must keep it.
  // Held in a ref: the auth gate must not re-run on every param change.
  const globalParams = useGlobalSearchParams();
  const globalParamsRef = useRef(globalParams);
  globalParamsRef.current = globalParams;
  const { isAuthenticated, isLoading: authLoading, user, session } = useAuth();
  const { hasSeenOnboarding, userRole, isLoading: projectLoading } = useProjects();
  // #74 (wave 5): a worker who claimed his crew profile (claim-crew) has an
  // account but may not have picked a persona — he came to see HIS profile,
  // not to set up a contracting business. CrewProvider sits above this, and
  // its roster already includes the rows he claimed.
  const claimedCrewWorker = useClaimedCrewProfile();
  // #107 / #131: the invite token signup() stored on the account
  // (user_metadata.invite_token). Read as a primitive so the gate re-runs only
  // when the token itself changes, not on every token refresh.
  const accountInviteToken = sanitizeInviteToken(session?.user?.user_metadata?.invite_token);
  const accountInviteHref = metadataInviteRedirect({ userRole, meta: { invite_token: accountInviteToken } });
  // #7: whether the last SETTLED gate run saw a session. A redirect to /login
  // right after one is a sign-out (or an expiry), not a signed-out visitor
  // opening a link: the screen he was on is his, possibly the previous
  // tenant's, and must not be stashed for whoever signs in next.
  const lastSettledAuthRef = useRef<boolean | null>(null);

  // Home-screen quick actions (long-press the app icon) route via the `href`
  // param declared on each action in app.json. Requires a native build —
  // quick actions cannot ship over OTA.
  useQuickActionRouting();

  useEffect(() => {
    if (authLoading || projectLoading || hasSeenOnboarding === null) return;
    const sessionJustEnded = lastSettledAuthRef.current === true && !isAuthenticated;
    lastSettledAuthRef.current = isAuthenticated;

    const inAuth = segments[0] === 'login' || segments[0] === 'signup';
    const inOnboarding = segments[0] === 'onboarding';
    const inPersonaSelect = (segments[0] as string) === 'persona-select';
    const inOnboardingPaywall = (segments[0] as string) === 'onboarding-paywall';
    const inResetPassword = segments[0] === 'reset-password';
    const inPrequalForm = segments[0] === 'prequal-form';
    // OAuth callback pages: Intuit (and other providers) redirect users here
    // from an in-app browser session. The web build has no MAGE session in
    // that browser context — auth-walling these routes was bouncing users to
    // /login mid-OAuth, breaking the QuickBooks Connect flow. The callback
    // page authenticates via a signed state HMAC, not the user's JWT.
    const inIntegrationsCallback = segments[0] === 'integrations';
    const inClaimCrew = (segments[0] as string) === 'claim-crew';
    // Collaboration invite redeem — opened via a tokenized email link, possibly
    // before the invitee has signed in. Must render (to store the token + prompt
    // sign-in) rather than bounce to /login and drop the token.
    const inAcceptInvite = (segments[0] as string) === 'accept-invite';
    // Read-only client/sub share viewers (`/shared-schedule?t=…`,
    // `/shared-photos?…`). These are opened by homeowners and subs who have
    // NO MAGE account — the token in the URL is the credential. Auth-walling
    // them bounced every external share link to /login (dead on arrival),
    // breaking the entire "Share with client" feature.
    // `client-view` belongs to the same family and was missing from it — the
    // rest of this file already classifies it as an "external / tokenized
    // viewer" (DESKTOP_SHELL_EXEMPT), but the auth gate still bounced every
    // homeowner to /login. It resolves its portal from the `?t=` access key via
    // the token-gated portal_get_snapshot RPC, so a session was never the
    // credential here; nothing renders without a valid key.
    const inSharedView = (segments[0] as string) === 'shared-schedule'
      || (segments[0] as string) === 'shared-photos'
      || (segments[0] as string) === 'shared-estimate'
      || (segments[0] as string) === 'shared-plan'
      || (segments[0] as string) === 'client-view';

    // Public magic-link destinations: never redirect away from these, even
    // when the user is unauthenticated. The prequal-form route is opened by
    // subcontractors via a tokenized email link; if we redirect to /login
    // before the token is consumed, the link is dead on arrival.
    if (inResetPassword || inPrequalForm || inIntegrationsCallback || inClaimCrew || inSharedView || inAcceptInvite) return;

    if (!isAuthenticated && !inAuth) {
      console.log('[Layout] Not authenticated — redirecting to login');
      // Stash the intended path so we can replay it post-login. Skip /login
      // itself and PUBLIC_PATHS (reset-password, prequal-form) — those never
      // need a post-login replay because they're either the destination of the
      // bounce or public routes that don't require auth.
      const firstSeg = pathname.replace(/^\//, '').split('?')[0];
      // #7: the Stack now stays mounted across a sign-out, so `pathname` here
      // is the screen the signed-out user was ON — never replay that for the
      // next account (the loader swap used to reset it to Home first).
      if (pathname !== '/login' && !PUBLIC_PATHS.has(firstSeg) && !sessionJustEnded) {
        void setPendingDeepLink(pathname + pendingLinkQuery(segments as string[], globalParamsRef.current));
      }
      router.replace('/login');
      return;
    }

    // #93: an invitee who just signed in on /login?invite=… (or /signup?invite=…)
    // is left alone here: login/signup route him back to /accept-invite
    // themselves (postSignInHref). A brand-new account has no persona, so the
    // gate below used to race that navigation and could win — replacing /login
    // with /persona-select and dropping the token. Exactly one navigation now:
    // the screen's. (A session restored straight onto an invite-bearing auth
    // screen, with no sign-in to finish, is sent on by the screen's own
    // mount check.) accept-invite is exempt from the gates, so he accepts
    // first and is walked through setup after.
    if (isAuthenticated && inAuth && sanitizeInviteToken(globalParamsRef.current[INVITE_PARAM])) return;

    // #107 / #131: an invite that rode the ACCOUNT rather than the URL. An
    // email sign-up from an invite confirms through a link that opens a new
    // tab (or device) at the root, with no token on the route — so he used to
    // get the GC's persona + onboarding (company name, rates, "price your
    // first bid") before he ever saw the job. signup() stored the token in
    // user_metadata; a brand-new account (no persona yet) that carries one
    // goes to accept it FIRST, ahead of the persona gate below. accept-invite
    // is exempt from these gates and walks him through the persona question
    // after, skipping the GC onboarding (#93). Once per token per launch
    // (markInviteTokenHandled), so leaving the invite screen cannot loop.
    if (isAuthenticated && accountInviteHref) {
      markInviteTokenHandled(accountInviteToken);
      console.log('[Layout] New account carries an invite — opening it before persona / onboarding');
      router.replace(accountInviteHref as never);
      return;
    }

    // Persona gate — runs BEFORE the onboarding gate. New users have to
    // pick a marketplace persona (contractor / client / both) before
    // entering the onboarding flow, because the onboarding question and
    // the home tab bar are persona-specific. Existing users (pre-this-
    // migration) were grandfathered as 'contractor' via the DB migration,
    // so they never hit this redirect. `userRole === null` after the
    // query resolves means the user has not yet picked.
    // #74: a claimed crew worker with no persona yet may stay on /crew — his
    // own profile. The persona question still meets him anywhere else (the
    // claim page's "Set up your own MAGE account" goes through it).
    const inCrew = (segments[0] as string) === 'crew';
    if (isAuthenticated && userRole === null && inCrew && claimedCrewWorker) return;
    if (isAuthenticated && userRole === null && !inPersonaSelect && !inOnboardingPaywall) {
      console.log('[Layout] No persona set — redirecting to /persona-select');
      router.replace('/persona-select' as never);
      return;
    }

    if (isAuthenticated && userRole !== null && !hasSeenOnboarding && !inOnboarding && !inOnboardingPaywall && !inPersonaSelect) {
      console.log('[Layout] First launch — redirecting to onboarding');
      router.replace('/onboarding');
      return;
    }

    if (isAuthenticated && inAuth) {
      console.log('[Layout] Already authenticated — redirecting to home');
      router.replace('/(tabs)/(home)' as any);
      return;
    }
  }, [isAuthenticated, hasSeenOnboarding, userRole, authLoading, projectLoading, segments, router, claimedCrewWorker, pathname, accountInviteHref, accountInviteToken]);

  // #74 (wave 5): claim-crew's "Sign in" stashes the claim address and sends
  // him to /login. The general replay below waits for a persona AND the GC
  // onboarding — minutes of setup a worker never asked for, long enough for
  // the stash's 10-minute life to run out, and the claim was lost. /claim-crew
  // is a PUBLIC route (exempt from every gate), so it is replayed as soon as
  // he is signed in, ahead of the persona question. Any other stash is put
  // back untouched for the general replay.
  const claimReplayRef = useRef(false);
  useEffect(() => {
    // Only once the persona is KNOWN to be unset (loads settled): a returning
    // user's null-while-loading must not take the stash the general replay
    // is about to read.
    if (authLoading || projectLoading || !isAuthenticated || userRole !== null || claimReplayRef.current) return;
    claimReplayRef.current = true;
    void (async () => {
      try {
        const pending = await takePendingDeepLink();
        if (!pending) return;
        const route = pending.replace(/^\//, '').split('?')[0];
        if (route === 'claim-crew') { router.replace(pending as never); return; }
        await setPendingDeepLink(pending);
      } catch {
        // Storage unavailable: the general replay (or none) applies.
      }
    })();
  }, [isAuthenticated, userRole, router, authLoading, projectLoading]);

  // Post-login deep-link replay: when the user completes sign-in AND all
  // onboarding gates (persona + onboarding screen), check for a stashed
  // pending path and navigate there instead of staying on the default home.
  //
  // The replayedRef guards against re-firing if deps change (e.g. a
  // re-render while the async read is in flight) — so this fires AT MOST
  // ONCE per component mount (i.e. once per app session). The stash itself
  // is consumed by takePendingDeepLink(), which removes the AsyncStorage key
  // immediately, so a second fire would read null anyway.
  //
  // We only replay when isAuthenticated + userRole + hasSeenOnboarding are
  // all satisfied — same three conditions the auth gate uses before it
  // considers a user "fully through" the first-run funnel. Attempting to
  // replay before those gates clear could navigate to a protected screen
  // before the app is ready, or interrupt the onboarding/persona flow.
  const replayedRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || userRole === null || !hasSeenOnboarding || replayedRef.current) return;
    replayedRef.current = true;
    (async () => {
      const pending = await takePendingDeepLink();
      if (pending) {
        // pending was validated by isInAppRoute inside setPendingDeepLink /
        // takePendingDeepLink — the `as any` cast here sidesteps typed-routes
        // exhaustive checking while keeping the runtime guarantee intact.
        //
        // #94: tab shell first, the stashed screen PUSHED on top. A bare
        // replace swapped the only root-stack entry for a screen outside
        // (tabs) — a teammate's project link opened with no back chevron and
        // no tab bar. A stash that IS the home tab needs only the replace.
        router.replace('/(tabs)/(home)' as any);
        const route = pending.replace(/^\//, '').split('?')[0];
        if (route && route !== '(tabs)' && route !== '(tabs)/(home)') router.push(pending as any);
      }
    })();
  }, [isAuthenticated, userRole, hasSeenOnboarding, router]);

  // Audit-2026-05-21 W1 (HIGH): per-route document.title on web.
  //
  // Pre-fix every browser tab showed "MAGE ID" because Expo Router's
  // Stack.Screen `title` prop drives the in-app React Navigation header
  // only — it doesn't bridge to document.title on web. Result: every
  // bookmark + every tab + every share-as-link preview reads identically.
  //
  // Global path→title mapper here covers every route in one place. Adding
  // a new route doesn't require touching each screen — just add an entry
  // here. Format is "Page · MAGE ID" matching the dot-separator convention
  // Linear/Vercel/Notion use. Native (iOS/Android) skips entirely.
  // (pathname is declared at the top of this function; moved up so the auth
  // gate can reference it for the pending-deeplink stash.)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    const title = pathToDocumentTitle(pathname);
    document.title = title ? `${title} · MAGE ID` : 'MAGE ID';
  }, [pathname]);

  // Desktop web shell (audit web#31): render the persistent sidebar around
  // the WHOLE Stack — not just the tabs — so stack routes like /invoice or
  // /safety keep primary nav on wide screens. Gated on:
  //  - layout.showSidebar: the same desktop breakpoint DesktopSidebar has
  //    always used (useResponsiveLayout — web ≥900px / any ≥1024px);
  //  - the exact auth/onboarding conditions the redirect effect above
  //    enforces (isAuthenticated, persona picked, onboarding seen) so the
  //    login/persona/onboarding flows stay full-bleed;
  //  - the current top-level route segment not being in
  //    DESKTOP_SHELL_EXEMPT (auth flows, tokenized external viewers, and
  //    presentation:'modal' routes keep their full-screen takeover).
  // The wrapper Views below render unconditionally so the <Stack> keeps a
  // stable position in the element tree — only the sidebar sibling mounts /
  // unmounts (auth/breakpoint) or toggles display (exempt routes), which
  // means navigation state survives shell toggles (e.g. entering and
  // leaving a modal route).
  const layout = useResponsiveLayout();
  const topSegment = (segments[0] ?? '') as string;
  const isShellExempt =
    DESKTOP_SHELL_EXEMPT.has(topSegment)
    // OAuth callback pages under /integrations/* (e.g. QuickBooks) render in
    // an in-app-browser context mid-flow — keep them full-bleed. The plain
    // /integrations settings screen keeps the shell.
    || pathname.startsWith('/integrations/');
  // Split "the user is in the desktop app" (shellEligible — mounts the
  // sidebar) from "this route shows the shell" (showDesktopShell — displays
  // it). Six sidebar destinations are shell-exempt modals (Ask MAGE,
  // Cost X-Ray, Copilot, Bid Advisor, Scan, Post a Project); if the sidebar
  // UNMOUNTED on every trip through them, its local state (openSections
  // expansion + rail scroll position) would reset on every round-trip. So
  // exempt routes only toggle `display` on the sidebar's wrapper — the
  // component stays mounted and keeps its state. Auth / breakpoint changes
  // still unmount it entirely (those SHOULD reset the rail). The wrapper is
  // a stable sibling before the Stack either way, so the Stack keeps its
  // positional identity and navigation state survives shell toggles.
  const shellEligible =
    layout.showSidebar
    && isAuthenticated
    && userRole !== null
    && hasSeenOnboarding === true;
  const showDesktopShell = shellEligible && !isShellExempt;

  // ── Native header + navigator theme, from the RESOLVED theme (wave 6b) ──
  // Built at render so a theme switch repaints every header. Three rules:
  //  - Light on a phone (and web below desktop) is byte-for-byte what shipped:
  //    the legacy grey bar + black title on the 44 routes that set their own
  //    header, and React Navigation's DefaultTheme on the rest.
  //  - Dark is finally dark: the legacy dark ground IS t.bg, and the title
  //    takes the light ink instead of the black frozen at module load.
  //  - Desktop web takes t.bg / t.text in both themes, so the header, the
  //    page and the DesktopPageFrame margins are one colour.
  const { colors: t, resolved: resolvedTheme } = useTheme();
  const legacy = legacyChrome(resolvedTheme);
  const headerBg = layout.isDesktop ? t.bg : legacy.background;
  const headerInk = layout.isDesktop ? t.text : legacy.text;
  const headerTint = Colors.primary;
  const headerTitled = React.useMemo(
    () => nativeHeaderOptions({ background: headerBg, title: headerInk, tint: headerTint }),
    [headerBg, headerInk, headerTint],
  );
  // Three routes set the bar and tint but never had a title colour — they
  // keep the navigator theme's ink, exactly as before.
  const headerChrome = React.useMemo(
    () => ({ headerStyle: headerTitled.headerStyle, headerTintColor: headerTitled.headerTintColor }),
    [headerTitled],
  );
  const navTheme = React.useMemo<NavTheme>(() => {
    if (resolvedTheme !== 'dark' && !layout.isDesktop) return DefaultTheme;
    const base = resolvedTheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, background: t.bg, card: t.bg, text: t.text, border: t.line },
    };
  }, [resolvedTheme, layout.isDesktop, t.bg, t.text, t.line]);

  // public/index.html (the SPA template; +html is ignored in single output)
  // paints <body> from a data-theme attribute its inline boot script sets
  // before hydration, so a dark-mode user never gets a light flash. Keep it
  // in step with in-app theme switches after hydration.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  // Cold-start gate: while the auth + project contexts are hydrating from
  // AsyncStorage/Supabase, render the branded construction loader instead
  // of a blank white screen. `hasSeenOnboarding === null` means the
  // onboarding-state check hasn't resolved yet either. Once all three are
  // ready, we drop into the normal Stack and the effect above handles
  // redirects.
  const bootstrapping =
    authLoading || projectLoading || hasSeenOnboarding === null;

  // #7: the loader REPLACES the Stack only on the first boot and on a switch
  // between two different accounts; any other reload (a sign-in from signed
  // out, the same user signing back in, a sign-out) draws it OVER the mounted
  // Stack. Tearing the navigator down on every sign-in threw away the screen
  // that was navigating — login/signup's return trip to /accept-invite?token=…
  // either threw or was discarded, and the invitee landed on Home, then
  // persona-select, then the GC onboarding. The gate above already waits while
  // these queries load, so nothing routes early under the overlay. Policy and
  // reasoning: utils/deepLinksInvite.rootNavPresentation.
  const navStateRef = useRef<RootNavState>(ROOT_NAV_INITIAL);
  const { mode: navMode, next: navNext } = rootNavPresentation(navStateRef.current, {
    bootstrapping,
    userId: user?.id ?? null,
  });
  navStateRef.current = navNext;

  if (navMode === 'loader') {
    return <CraneLoader label="MAGE ID" />;
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {shellEligible && (
        // flexDirection:'row' so the sidebar (explicit width, no height)
        // stretches to full height via the cross-axis, exactly as it did as
        // a direct child of the outer row.
        <View style={{ display: showDesktopShell ? 'flex' : 'none', flexDirection: 'row' }}>
          <DesktopSidebar width={layout.sidebarWidth} />
        </View>
      )}
      {/* Keyed by the account generation: a switch between two different
          accounts remounts the navigator fresh (the previous tenant's screens
          never survive in memory); a plain reload keeps it mounted. */}
      {/* NavThemeProvider: the navigator's colours from the resolved theme.
          screenLayout: every root route renders inside DesktopPageFrame,
          which caps its column at Layout.page[kind] on desktop web and
          returns the screen untouched everywhere else (utils/desktopPage). */}
      <NavThemeProvider value={navTheme}>
      <View style={{ flex: 1 }} key={`stack-${navNext.generation}`}>
        <Stack screenOptions={{ headerBackTitle: "Back", headerTitleStyle: NATIVE_HEADER_TITLE_FACE }} screenLayout={renderDesktopPageFrame}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="ask" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="brief" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="track-record" options={{ headerShown: false }} />
      <Stack.Screen name="auto-bids" options={{ headerShown: false }} />
      <Stack.Screen name="waiting-on" options={{ headerShown: false }} />
      <Stack.Screen name="delay-events" options={{ headerShown: false }} />
      <Stack.Screen name="home-passport" options={{ headerShown: false }} />
      <Stack.Screen name="sub-profile" options={{ headerShown: false }} />
      <Stack.Screen name="widget-setup" options={{ headerShown: false }} />
      <Stack.Screen name="week-close" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="leads" options={{ title: 'Pipeline' }} />
      <Stack.Screen name="lead-detail" options={{ title: 'Lead' }} />
      <Stack.Screen name="buyout" options={{ title: 'Buyout' }} />
      <Stack.Screen name="buyout-package" options={{ title: 'Bid Package' }} />
      <Stack.Screen name="bid-leveling" options={{ title: 'Bid Leveling' }} />
      <Stack.Screen name="win-optimizer" options={{ title: 'Win Optimizer' }} />
      <Stack.Screen name="smart-proposal" options={{ title: 'Smart Proposal' }} />
      <Stack.Screen name="material-receipt" options={{ title: 'Material Receipt' }} />
      <Stack.Screen name="last-planner" options={{ title: 'Last Planner' }} />
      <Stack.Screen name="plan-intelligence" options={{ title: 'Plan Intelligence' }} />
      {/* gestureEnabled:false — the wizard holds an unsaved multi-task draft.
          A swipe-down (iOS) discarded it with no prompt; the in-app back
          button's confirm can't intercept the gesture. */}
      <Stack.Screen name="schedule-wizard" options={{ headerShown: false, presentation: 'modal', gestureEnabled: false }} />
      <Stack.Screen name="schedule-builder" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="copilot" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="copilot-hub" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="schedule-import" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="scan" options={{ headerShown: false, presentation: 'modal' }} />
      {/* AI tool doors render their own ToolHeader chrome (sim-audit #5) —
          headerShown:false here so the default RN header never flashes in. */}
      <Stack.Screen name="ai-punch" options={{ headerShown: false }} />
      <Stack.Screen name="photo-triage" options={{ title: 'AI Photo Triage' }} />
      <Stack.Screen name="extract-submittals" options={{ headerShown: false }} />
      <Stack.Screen name="compare-drawings" options={{ headerShown: false }} />
      <Stack.Screen name="tax-1099-export" options={{ title: '1099-NEC Export' }} />
      <Stack.Screen name="warranty-walk" options={{ title: '11-month walk' }} />
      <Stack.Screen
        name="login"
        options={{
          headerShown: false,
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="signup"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="onboarding"
        options={{
          headerShown: false,
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="persona-select"
        options={{
          headerShown: false,
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="reset-password"
        options={{
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="project-detail"
        options={{
          title: "Project Details",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="change-order"
        options={{ headerShown: false }}
      />
      {/* T&M / extra-work field ticket — the signed-on-site record that makes
          out-of-scope work billable. Renders its own ToolHeader. */}
      <Stack.Screen
        name="field-ticket"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="invoice"
        options={{
          title: "Invoice",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="bill-from-estimate"
        options={{
          title: "Bill from Estimate",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="activity-feed"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="daily-report"
        options={{
          title: "Daily Report",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="punch-list"
        options={{
          title: "Punch List",
          ...headerTitled,
        }}
      />
      <Stack.Screen name="safety" options={{ title: 'Safety' }} />
      <Stack.Screen name="safety-jha" options={{ title: 'JHAs' }} />
      <Stack.Screen name="safety-toolbox" options={{ title: 'Toolbox Talks' }} />
      <Stack.Screen name="safety-incidents" options={{ title: 'Incidents' }} />
      <Stack.Screen name="safety-hazards" options={{ title: 'Hazard Log' }} />
      <Stack.Screen name="safety-inspections" options={{ title: 'Inspections' }} />
      <Stack.Screen name="safety-certifications" options={{ title: 'Certifications' }} />
      <Stack.Screen name="safety-forms" options={{ title: 'Forms Library' }} />
      <Stack.Screen name="safety-osha" options={{ title: 'OSHA 300 Log' }} />
      <Stack.Screen
        name="punch-walk"
        options={{ headerShown: false }}
      />
      <Stack.Screen name="punch-pin" options={{ headerShown: false }} />
      <Stack.Screen
        name="warranties"
        options={{
          title: "Warranties",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="retention"
        options={{
          title: "Retention",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="payment-predictions"
        options={{
          title: "Payment Forecast",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="contacts"
        options={{
          title: "Contacts",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="crew"
        options={{
          title: "Crew",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="paywall"
        options={{
          headerShown: false,
          presentation: 'modal',
        }}
      />
      <Stack.Screen name="cost-xray" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen
        name="onboarding-paywall"
        options={{
          headerShown: false,
          presentation: 'modal',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="rfi"
        options={{
          title: "RFI",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="submittal"
        options={{
          title: "Submittal",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="oac-meeting"
        options={{
          title: "OAC Meetings",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="coi-vault"
        options={{
          title: "COI Vault",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="budget-dashboard"
        options={{
          title: "Budget Dashboard",
          ...headerTitled,
        }}
      />
      <Stack.Screen name="wip-report" options={{ title: 'WIP Report' }} />
      {/* Construction News (founder request 2026-09-22): publisher feed
          headlines, merged by the construction-news edge function. Doors:
          the Discover ▸ Tools tile and the desktop sidebar's WORKSPACE row. */}
      <Stack.Screen
        name="construction-news"
        options={{
          title: "Construction News",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="job-costing"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="living-estimate"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="generative-setup"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="schedule-review"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="margin-risk"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="sub-scorecard"
        options={{ title: 'Sub Scorecard' }}
      />
      <Stack.Screen
        name="buyout-scope-gap"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="estimate-accuracy"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="estimate-scorecard"
        options={{ headerShown: false, title: 'Estimate Scorecard' }}
      />
      <Stack.Screen
        name="deliveries"
        options={{ headerShown: false, title: 'Deliveries' }}
      />
      <Stack.Screen
        name="building-access"
        options={{ headerShown: false, title: 'Building Access' }}
      />
      <Stack.Screen
        name="estimate-confidence"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="estimate-calibration"
        options={{ title: 'Estimate Calibration' }}
      />
      <Stack.Screen
        name="cost-database"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="cost-seed"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="area-takeoff"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="project-memory"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="portfolio-margin"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="business"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="margin-alerts"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="prequal-manager"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="prequal-form"
        options={{ headerShown: false }}
      />
      <Stack.Screen name="claim-crew" options={{ headerShown: false }} />
      <Stack.Screen name="accept-invite" options={{ headerShown: false }} />
      <Stack.Screen
        name="get-verified"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="import-pipeline"
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <Stack.Screen
        name="managed-property"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="work-order"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="sub-portal-setup"
        options={{
          title: "Sub Portal",
          ...headerChrome,
        }}
      />
      <Stack.Screen
        name="sub-portals"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="public-profile-setup"
        options={{
          title: "Public Profile",
          ...headerChrome,
        }}
      />
      <Stack.Screen
        name="notifications-settings"
        options={{
          title: "Notifications",
          ...headerChrome,
        }}
      />
      <Stack.Screen
        name="notifications-inbox"
        options={{ headerShown: false }}
      />
      {/* Help -> Tutorials: practise a real flow on the sample job. A plain
          pushed screen, not a modal — a tutorial it starts pushes the sample
          hub and the real screen on top of it. */}
      <Stack.Screen name="tutorials" options={{ title: 'Tutorials' }} />
      <Stack.Screen
        name="drawing-analyzer"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="takeoff"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="takeoff-estimate"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="project-files"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="post-rfp"
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <Stack.Screen
        name="my-rfps"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="rfp-detail"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="submit-bid-response"
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <Stack.Screen
        name="rfp-responses-review"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="nearby-rfps"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="reports"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="contract"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="selections"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="lien-waivers"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="closeout-binder"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="handover"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="photo-annotator"
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <Stack.Screen
        name="plans"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="plan-viewer"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="equipment-detail"
        options={{
          title: "Equipment",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="bid-detail"
        options={{
          title: "Bid Details",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="post-bid"
        options={{
          title: "Post a Bid",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="company-detail"
        options={{
          title: "Company",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="company-profile"
        options={{
          title: "Company Profile",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="job-detail"
        options={{
          title: "Job Details",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="worker-detail"
        options={{
          title: "Worker Profile",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="post-job"
        options={{
          title: "Post a Job",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="messages"
        options={{
          title: "Messages",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="cash-flow"
        options={{
          title: "Cash Flow",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="integrations"
        options={{
          title: "Integrations",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="time-tracking"
        options={{
          title: "Time Tracking",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="documents"
        options={{
          title: "Documents",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="permits"
        options={{
          title: "Permits",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="weekly-snapshot"
        options={{
          title: "This Week",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="payments-setup"
        options={{
          title: "Payments",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="qbo-setup"
        options={{
          title: "QuickBooks",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="qbo-review"
        options={{
          title: "QuickBooks Costs",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="integrations/qbo/callback"
        options={{
          title: "QuickBooks Connection",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="dev-seeder"
        options={{
          title: "Demo Seeder",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="dev-flagship-seeder"
        options={{
          title: "Flagship Seeder",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="dev-ar-measure"
        options={{
          title: "AR Measure (dev)",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="report-inbox"
        options={{
          title: "Report Inbox",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="profit-leak-history"
        options={{
          title: "Profit Leak History",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="payments"
        options={{
          title: "Payments",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="aia-pay-app"
        options={{
          title: "AIA Pay Application",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="data-export"
        options={{
          title: "Export My Data",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="scope-sheet"
        options={{
          title: "Scope Sheet",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="connect-claude"
        options={{
          title: "Connect Claude",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="data-import"
        options={{
          title: "Import Data",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="client-update"
        options={{
          title: "Weekly Client Update",
          ...headerTitled,
        }}
      />
      <Stack.Screen
        name="client-messages"
        options={{
          title: "Messages",
          ...headerTitled,
        }}
      />
      {/* UX-F14: gestureEnabled:false on the three estimate modals — they hold
          an unsaved multi-step draft with no persistence, and onboarding hands
          a new GC straight into /estimate-wizard. A natural pull-down while
          scrolling discarded the first bid with no prompt (same reasoning as
          schedule-wizard above). */}
      <Stack.Screen
        name="estimate-wizard"
        options={{
          title: "Quick Estimate",
          presentation: "modal",
          gestureEnabled: false,
          ...headerTitled,
        }}
      />
      {/* judges renders its own in-content header (eyebrow + "Should I bid
          this?" + back chevron) — the route-level nav header doubled it with
          a "Bid Advisor" bar + a dead band (sim-audit #9). */}
      <Stack.Screen name="judges" options={{ presentation: "modal", headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="quick-quote" options={{ presentation: "modal", headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="project-scope" options={{ headerShown: false }} />
      <Stack.Screen name="client-outbox" options={{ headerShown: false }} />
        </Stack>
      </View>
      </NavThemeProvider>
      {/* Right-hand dock slot: 0 px unless something is docked, desktop
          shell only. Nothing opens it yet (wave 6c moves Ask into it). */}
      {shellEligible && <ShellDockHost visible={showDesktopShell} />}
      {navMode === 'stack+overlay' ? (
        // Blocks input while the boot reads run, exactly as the full-screen
        // loader did, without unmounting what is underneath.
        <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]} testID="root-nav-reload-overlay">
          <CraneLoader label="MAGE ID" />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The desktop shell's right-hand dock (components/desktop/ShellDock), scoped
 * to the signed-in account: `resetKey` empties the dock whenever the user
 * changes, so one tenant's docked panel never survives into the next account.
 * Mounted around RootLayoutNav AND the global overlays (BrainSurface), so both
 * a screen and the Ask FAB can open it in wave 6c.
 */
function ShellDockTenantScope({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <ShellDockProvider resetKey={user?.id ?? null}>{children}</ShellDockProvider>;
}

function SearchHotkeyListener() {
  const { toggleSearch } = useSearch();
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      const isK = e.key === 'k' || e.key === 'K';
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleSearch();
      }
    };
    // @ts-ignore - DOM event on web
    window.addEventListener('keydown', handler);
    // @ts-ignore
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSearch]);
  return null;
}

function ThemeLoader({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const stored = await AsyncStorage.getItem('mageid_settings');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.themeColors) {
            // Only the PRIMARY is read: the whole accent family is derived
            // from it (constants/colors.ts deriveAccentPalette). The preset's
            // second swatch is still persisted so older `theme_colors` rows
            // round-trip, but it no longer paints anything.
            //
            // And only a hue THE PICKER STILL OFFERS. `theme_colors` is a
            // Supabase jsonb column written by older builds whose preset list
            // was different (Settings falls back to 'mage' for "any
            // unrecognized primary" for exactly that reason). Before the family
            // was derived, a retired hue only reached the ~420 Colors.primary
            // reads; now it would paint the whole app in a hue no guard has
            // ever measured, while the picker showed MAGE Orange as selected —
            // the app and its own settings screen disagreeing about what colour
            // it is. scripts/validate-contrast.ts check 12 proves AA for the
            // nine presets, so the nine presets are what may be applied
            // (review 2026-09-07).
            const known = THEME_PRESETS.some((p) => p.primary === parsed.themeColors.primary);
            setCustomPrimary(known ? parsed.themeColors.primary : null);
            console.log('[Theme] Loaded custom accent hue:', known ? parsed.themeColors.primary : 'brand default (retired preset)');
          }
        }
      } catch (err) {
        console.log('[Theme] Failed to load theme:', err);
      }
    };
    void loadTheme();
  }, []);

  return <>{children}</>;
}

export default Sentry.wrap(function RootLayout() {
  // Load Fraunces — used for the onboarding display headline + any future
  // expressive serif moments. We wait for fonts before hiding the splash
  // so the first paint already has the right typography. If the font load
  // fails (network blip on first launch), we still hide the splash after
  // a 1s timeout so the user is never blocked.
  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Fraunces_700Bold,
    Fraunces_700Bold_Italic,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  // Splash hand-off state.
  //   nativeHidden — the pre-JS native splash (app.json level-line) has been
  //     dismissed. We hide it only once fonts are ready (or a failsafe fires)
  //     so the animated BrandSplash below already has its Fraunces wordmark.
  //   brandSplashDone — the animated BrandSplash has finished playing and the
  //     app should now be fully revealed. It plays exactly once per cold
  //     start (guarded by the fact this component mounts once).
  const [nativeHidden, setNativeHidden] = useState(false);
  const [brandSplashDone, setBrandSplashDone] = useState(false);

  useEffect(() => {
    // Hand the native splash off to the animated BrandSplash: the app tree
    // renders underneath from the first frame, so hiding the native layer
    // reveals BrandSplash (an ink overlay identical to the native ink) with
    // no white flash, and interactivity is never blocked beyond the ~1s
    // animation — the app is already mounted and hydrating below it.
    if (fontsLoaded) {
      void SplashScreen.hideAsync();
      setNativeHidden(true);
      return;
    }
    // Failsafe: hand off after 1.2s even if fonts haven't loaded. BrandSplash
    // + onboarding fall back to the platform serif so they remain usable.
    const timer = setTimeout(() => {
      void SplashScreen.hideAsync();
      setNativeHidden(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [fontsLoaded]);

  const handleBrandSplashDone = useCallback(() => setBrandSplashDone(true), []);

  // Capture the marketing-site signup intent (?plan=pro&trial=14) on first
  // web load. Runs once per session, before auth, so a fresh arrival from the
  // marketing site always persists the intent even when unauthenticated.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const intent = parseSignupIntent(new URLSearchParams(window.location.search));
      if (intent) void persistSignupIntent(intent);
    }
  }, []);

  return (
    <ErrorBoundary fallbackMessage="MAGE ID encountered an error. Tap below to restart.">
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <ThemeLoader>
            <ThemeProvider>
            <AuthProvider>
              <SubscriptionProvider>
                <ProjectProvider>
                  {/* The active job (wave 6b): reads the project list and the user,
                      so it sits just inside ProjectProvider. */}
                  <ActiveProjectProvider>
                  <ScanProvider>
                  <WipProvider>
                  <CrewProvider>
                  {/* Time entries: ONE store for the Time Tracking screen and
                      the global voice mic (BrainSurface). As a per-mount hook
                      each copy overwrote the other's clock-ins on disk and
                      posted shift alerts the other could not cancel (audit
                      round 2, field-ops #8). Below AuthProvider (reads the
                      user) and QueryClientProvider (invalidates the mirror). */}
                  <TimeEntriesProvider>
                  <SafetyProvider>
                  <PropertyProvider>
                  <MaterialCartProvider>
                    <BidsProvider>
                      <CompaniesProvider>
                        <HireProvider>
                          <NotificationProvider>
                            {/* Autonomy gates: shared, not per-consumer. Three
                                screens read this; as a plain hook each ran its
                                own profiles + brain_predictions load AND its
                                own copy of the demotion/promotion transition
                                detector, duplicating receipts. Must sit below
                                AuthProvider (reads useAuth().user) AND below
                                ProjectProvider — its load is gated on
                                projects.length > 0 (useCoreData), so a signed-in
                                user with no projects triggers no request. The
                                provider is always mounted for context shape; only
                                the LOAD is deferred. */}
                            <AutonomyProvider>
                            <SearchProvider>
                            <ShellDockTenantScope>
                              <MagicLinkHandler />
                              <AnalyticsManager />
                              <OfflineSyncManager />
                              <MarginAlertManager />
                              <RootLayoutNav />
                              <BrainSurface />
                              {/* Learn-by-doing tutorials: the coach-mark engine's
                                  root layer (zIndex 9500 — above NailItToast,
                                  below Confetti; AlertHost is a Modal and draws
                                  above it). Renders null when no tutorial runs. */}
                              <TutorialHost />
                              <GlobalOfflineSyncPill />
                              <SearchHotkeyListener />
                              {/* Renders alerts on web, where RN's Alert is a
                                  no-op. Must stay mounted app-wide. */}
                              <AlertHost />
                              <NailItToastHost />
                              <ConfettiHost />
                            </ShellDockTenantScope>
                            </SearchProvider>
                            </AutonomyProvider>
                          </NotificationProvider>
                        </HireProvider>
                      </CompaniesProvider>
                    </BidsProvider>
                  </MaterialCartProvider>
                  </PropertyProvider>
                  </SafetyProvider>
                  </TimeEntriesProvider>
                  </CrewProvider>
                  </WipProvider>
                  </ScanProvider>
                  </ActiveProjectProvider>
                </ProjectProvider>
              </SubscriptionProvider>
            </AuthProvider>
            </ThemeProvider>
          </ThemeLoader>
          {/* Animated launch — mounts as a full-screen overlay ABOVE the app
              (which renders + hydrates underneath) once the native splash is
              handed off, plays the level-settle once, then unmounts. */}
          {nativeHidden && !brandSplashDone && (
            <BrandSplash onDone={handleBrandSplashDone} />
          )}
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
});
