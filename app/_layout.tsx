import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Fraunces_500Medium, Fraunces_700Bold, Fraunces_700Bold_Italic } from "@expo-google-fonts/fraunces";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import React, { useEffect, useRef } from "react";
import { AppState, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ConstructionLoader from "@/components/ConstructionLoader";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProjectProvider, useProjects } from "@/contexts/ProjectContext";
import { SubscriptionProvider, useSubscription } from "@/contexts/SubscriptionContext";
import { MaterialCartProvider } from "@/contexts/MaterialCartContext";
import { PropertyProvider } from "@/contexts/PropertyContext";
import { BidsProvider } from "@/contexts/BidsContext";
import { CompaniesProvider } from "@/contexts/CompaniesContext";
import { HireProvider } from "@/contexts/HireContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { SearchProvider, useSearch } from "@/contexts/SearchContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import UniversalSearch from "@/components/UniversalSearch";
import { NailItToastHost } from "@/components/animations/NailItToast";
import { ConfettiHost } from "@/components/animations/Confetti";
import { Colors, setCustomColors } from "@/constants/colors";
import ErrorBoundary from "@/components/ErrorBoundary";
import MarginAlertManager from "@/components/MarginAlertManager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { processOfflineQueue } from "@/utils/offlineQueue";
import { initAnalytics, identifyAnalyticsUser, resetAnalyticsUser } from "@/utils/posthog";
import { patchAlertForWeb } from "@/utils/webAlertPolyfill";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import * as Sentry from '@sentry/react-native';

// Patch react-native's Alert.alert at module load so every existing call
// site works on web. RN-Web's native Alert is a no-op for multi-button
// alerts, which silently breaks every Cancel/Confirm flow (sign out,
// delete, etc.). Routing through window.confirm restores the behavior.
patchAlertForWeb();

/**
 * Audit-2026-05-21 W1: map pathname → human-readable page title for the
 * browser tab on web. Returns null for routes not in the table (the effect
 * falls back to plain "MAGE ID" — no false labels). Add entries when new
 * top-level routes ship.
 */
function pathToDocumentTitle(pathname: string): string | null {
  if (!pathname || pathname === '/') return 'Projects';
  // Strip query / hash if router ever passes them.
  const path = pathname.split('?')[0].split('#')[0];
  // Exact matches first.
  const exact: Record<string, string> = {
    '/': 'Projects',
    '/summary': 'Summary',
    '/login': 'Sign in',
    '/signup': 'Create account',
    '/onboarding': 'Welcome',
    '/persona-select': 'Welcome',
    '/onboarding-paywall': 'Subscribe',
    '/paywall': 'Subscribe',
    '/reset-password': 'Reset password',
    '/settings': 'Settings',
    '/settings/appearance': 'Appearance',
    '/notifications-inbox': 'Notifications',
    '/messages': 'Messages',
    '/report-inbox': 'Report inbox',
    '/activity-feed': 'Activity',
    '/payments': 'Payments',
    '/payments-setup': 'Stripe Connect',
    '/plans': 'Plans',
    '/reports': 'Reports',
    '/invoice': 'Invoice',
    '/aia-pay-app': 'AIA pay application',
    '/change-order': 'Change order',
    '/budget-dashboard': 'Budget dashboard',
    '/cash-flow': 'Cash flow',
    '/job-costing': 'Job costing',
    '/living-estimate': 'Living estimate',
    '/generative-setup': 'Set up project',
    '/margin-risk': 'Margin risk',
    '/buyout-scope-gap': 'Scope-gap audit',
    '/estimate-accuracy': 'Estimate accuracy',
    '/estimate-confidence': 'Estimate confidence',
    '/estimate-calibration': 'Estimate calibration',
    '/cost-database': 'Cost database',
    '/area-takeoff': 'Visual takeoff',
    '/portfolio-margin': 'Margin board',
    '/margin-alerts': 'Margin alerts',
    '/contract': 'Contract',
    '/selections': 'Selections',
    '/closeout-binder': 'Closeout binder',
    '/punch-list': 'Punch list',
    '/punch-walk': 'Punch walk',
    '/ai-punch': 'AI punch',
    '/rfi': 'RFI',
    '/submittal': 'Submittal',
    '/oac-meeting': 'OAC meeting',
    '/daily-report': 'Daily report',
    '/time-tracking': 'Time tracking',
    '/photo-triage': 'Photo triage',
    '/leads': 'Pipeline',
    '/contacts': 'Contacts',
    '/buyout': 'Buyout',
    '/buyout-package': 'Bid package',
    '/bid-leveling': 'Bid leveling',
    '/win-optimizer': 'Win optimizer',
    '/smart-proposal': 'Smart proposal',
    '/material-receipt': 'Material receipt',
    '/plan-intelligence': 'Plan intelligence',
    '/bill-from-estimate': 'Bill from estimate',
    '/client-messages': 'Client messages',
    '/client-portal-setup': 'Client portal',
    '/client-view': 'Client view',
    '/client-update': 'Client update',
    '/permits': 'Permits',
    '/warranties': 'Warranties',
    '/lien-waivers': 'Lien waivers',
    '/coi-vault': 'COI vault',
    '/prequal-manager': 'Prequal manager',
    '/prequal-form': 'Prequal form',
    '/sub-portals': 'Sub portals',
    '/sub-portal-setup': 'Sub portal',
    '/public-profile-setup': 'Public profile',
    '/integrations': 'Integrations',
    '/handover': 'Handover',
    '/weekly-snapshot': 'Weekly snapshot',
    '/schedule-pro': 'Schedule',
    '/schedule-wizard': 'Schedule wizard',
    '/shared-schedule': 'Schedule',
    '/estimate-wizard': 'Estimate',
    '/bid-detail': 'Bid',
    '/submit-bid-response': 'Submit bid',
    '/post-bid': 'Post bid',
    '/post-homeowner-request': 'Post project',
    '/post-community-bid': 'Post bid',
  };
  if (exact[path]) return exact[path];
  // Tab-grouped routes — strip /(tabs) prefix.
  if (path.startsWith('/(tabs)')) {
    return pathToDocumentTitle(path.replace('/(tabs)', '')) ?? null;
  }
  // Common nested patterns.
  if (path.startsWith('/discover/')) {
    const seg = path.replace('/discover/', '');
    return seg.charAt(0).toUpperCase() + seg.slice(1);
  }
  if (path.startsWith('/materials/')) return 'Materials';
  if (path.startsWith('/equipment/')) return 'Equipment';
  if (path.startsWith('/marketplace/')) return 'Marketplace';
  if (path.startsWith('/mage-id-bids/')) return 'MAGE ID Bids';
  if (path.startsWith('/construction-ai/')) return 'Construction AI';
  // Detail routes like /invoice/123 — return the parent label.
  const top = path.split('/')[1];
  const topRoute = '/' + top;
  if (exact[topRoute]) return exact[topRoute];
  return null;
}

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
      retry: (failureCount, error) => {
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
          return false;
        }
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
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          console.warn('[MagicLink] setSession failed:', error.message);
        } else {
          console.log('[MagicLink] session set from magic link');
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
  }, []);
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

function OfflineSyncManager() {
  const appState = useRef(AppState.currentState);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;

    void processOfflineQueue().then(({ processed }) => {
      if (processed > 0) {
        console.log('[OfflineSync] Processed', processed, 'queued mutations on startup');
      }
    }).catch((err) => {
      console.log('[OfflineSync] Failed to process queue on startup:', err);
    });

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        console.log('[OfflineSync] App foregrounded, processing queue');
        void processOfflineQueue().catch((err) => {
          console.log('[OfflineSync] Failed to process queue on foreground:', err);
        });
      }
      appState.current = nextState;
    });

    return () => {
      subscription.remove();
    };
  }, [isAuthenticated]);

  return null;
}

// Keys for the 3-day free-tier onboarding-paywall re-show gate. First-seen
// is stamped once by the paywall screen itself; last-seen is stamped on
// every show (close or open) so the gate can skip same-day reopens.
const PAYWALL_GATE_FIRST_KEY = 'buildwise_onboarding_paywall_first_at';
const PAYWALL_GATE_LAST_KEY = 'buildwise_onboarding_paywall_last_at';
const PAYWALL_GATE_WINDOW_DAYS = 3;

// Pure helper so the gate decision is testable without mounting the layout.
// Returns true when the paywall should be re-shown on this cold boot.
function shouldShowOnboardingPaywallGate(params: {
  firstSeenIso: string | null;
  lastSeenIso: string | null;
  now: Date;
}): boolean {
  const { firstSeenIso, lastSeenIso, now } = params;
  // If first-seen is missing, the user hasn't hit the paywall post-onboarding
  // yet. Don't preempt here — the onboarding screen's own redirect will
  // handle it when they finish/skip.
  if (!firstSeenIso) return false;
  const first = new Date(firstSeenIso);
  const ageDays = (now.getTime() - first.getTime()) / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(ageDays) || ageDays > PAYWALL_GATE_WINDOW_DAYS) return false;
  // Don't show more than once per calendar day. We compare Y-M-D strings
  // rather than millisecond deltas so a user who dismisses at 11pm doesn't
  // get re-shown at 1am — the check is "did we already show today?"
  if (lastSeenIso) {
    const last = new Date(lastSeenIso);
    const sameDay =
      last.getFullYear() === now.getFullYear() &&
      last.getMonth() === now.getMonth() &&
      last.getDate() === now.getDate();
    if (sameDay) return false;
  }
  return true;
}

function RootLayoutNav() {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { hasSeenOnboarding, userRole, isLoading: projectLoading, projects } = useProjects();
  const { tier } = useSubscription();
  const paywallGateRanRef = useRef(false);

  useEffect(() => {
    if (authLoading || projectLoading || hasSeenOnboarding === null) return;

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

    // Public magic-link destinations: never redirect away from these, even
    // when the user is unauthenticated. The prequal-form route is opened by
    // subcontractors via a tokenized email link; if we redirect to /login
    // before the token is consumed, the link is dead on arrival.
    if (inResetPassword || inPrequalForm || inIntegrationsCallback) return;

    if (!isAuthenticated && !inAuth) {
      console.log('[Layout] Not authenticated — redirecting to login');
      router.replace('/login');
      return;
    }

    // Persona gate — runs BEFORE the onboarding gate. New users have to
    // pick a marketplace persona (contractor / client / both) before
    // entering the onboarding flow, because the onboarding question and
    // the home tab bar are persona-specific. Existing users (pre-this-
    // migration) were grandfathered as 'contractor' via the DB migration,
    // so they never hit this redirect. `userRole === null` after the
    // query resolves means the user has not yet picked.
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

    // 3-day free-tier paywall re-show gate. Runs at most once per
    // mount — if the user dismisses we don't re-queue it mid-session,
    // only on the next cold boot. Gate only fires when we've resolved
    // a concrete tier; while tier is still hydrating from RC, skip.
    //
    // Launch-readiness audit (2026-05-16): also require the user to have
    // created at least one REAL (non-sample) project. Pre-fix, a brand-new
    // user who finished onboarding but hadn't built anything got the
    // gesture-locked paywall re-shoved at them every cold boot for 3 days
    // before ever seeing value — a documented abandonment driver. The
    // auto-seeded "Sample — …" projects don't count as engagement.
    const hasRealProject = projects.some(p => !p.name.startsWith('Sample — '));
    if (
      isAuthenticated &&
      hasSeenOnboarding &&
      tier === 'free' &&
      hasRealProject &&
      !inOnboardingPaywall &&
      !inOnboarding &&
      !paywallGateRanRef.current
    ) {
      paywallGateRanRef.current = true;
      (async () => {
        try {
          const [firstSeenIso, lastSeenIso] = await Promise.all([
            AsyncStorage.getItem(PAYWALL_GATE_FIRST_KEY),
            AsyncStorage.getItem(PAYWALL_GATE_LAST_KEY),
          ]);
          const show = shouldShowOnboardingPaywallGate({
            firstSeenIso,
            lastSeenIso,
            now: new Date(),
          });
          if (show) {
            console.log('[Layout] 3-day gate: showing onboarding paywall');
            router.push('/onboarding-paywall' as never);
          }
        } catch (err) {
          console.log('[Layout] paywall gate check failed', err);
        }
      })();
    }
  }, [isAuthenticated, hasSeenOnboarding, userRole, authLoading, projectLoading, segments, router, tier, projects]);

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
  const pathname = usePathname();
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    const title = pathToDocumentTitle(pathname);
    document.title = title ? `${title} · MAGE ID` : 'MAGE ID';
  }, [pathname]);

  // Cold-start gate: while the auth + project contexts are hydrating from
  // AsyncStorage/Supabase, render the branded construction loader instead
  // of a blank white screen. `hasSeenOnboarding === null` means the
  // onboarding-state check hasn't resolved yet either. Once all three are
  // ready, we drop into the normal Stack and the effect above handles
  // redirects.
  const bootstrapping =
    authLoading || projectLoading || hasSeenOnboarding === null;

  if (bootstrapping) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: Colors.background,
        }}
        testID="cold-start-loader"
      >
        <ConstructionLoader size="lg" label="MAGE ID" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="ask" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="leads" options={{ title: 'Pipeline' }} />
      <Stack.Screen name="lead-detail" options={{ title: 'Lead' }} />
      <Stack.Screen name="buyout" options={{ title: 'Buyout' }} />
      <Stack.Screen name="buyout-package" options={{ title: 'Bid Package' }} />
      <Stack.Screen name="bid-leveling" options={{ title: 'Bid Leveling' }} />
      <Stack.Screen name="win-optimizer" options={{ title: 'Win Optimizer' }} />
      <Stack.Screen name="smart-proposal" options={{ title: 'Smart Proposal' }} />
      <Stack.Screen name="material-receipt" options={{ title: 'Material Receipt' }} />
      <Stack.Screen name="plan-intelligence" options={{ title: 'Plan Intelligence' }} />
      <Stack.Screen name="schedule-wizard" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="ai-punch" options={{ title: 'AI Punch from Photos' }} />
      <Stack.Screen name="photo-triage" options={{ title: 'AI Photo Triage' }} />
      <Stack.Screen name="extract-submittals" options={{ title: 'Extract Submittals' }} />
      <Stack.Screen name="compare-drawings" options={{ title: 'Compare Drawings' }} />
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
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="change-order"
        options={{
          title: "Change Order",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="invoice"
        options={{
          title: "Invoice",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="bill-from-estimate"
        options={{
          title: "Bill from Estimate",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
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
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="punch-list"
        options={{
          title: "Punch List",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="punch-walk"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="warranties"
        options={{
          title: "Warranties",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="retention"
        options={{
          title: "Retention",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="payment-predictions"
        options={{
          title: "Payment Forecast",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="contacts"
        options={{
          title: "Contacts",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="paywall"
        options={{
          headerShown: false,
          presentation: 'modal',
        }}
      />
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
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="submittal"
        options={{
          title: "Submittal",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="oac-meeting"
        options={{
          title: "OAC Meetings",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="coi-vault"
        options={{
          title: "COI Vault",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="budget-dashboard"
        options={{
          title: "Budget Dashboard",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
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
        name="margin-risk"
        options={{ headerShown: false }}
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
        name="area-takeoff"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="portfolio-margin"
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
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
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
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
        }}
      />
      <Stack.Screen
        name="notifications-settings"
        options={{
          title: "Notifications",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
        }}
      />
      <Stack.Screen
        name="notifications-inbox"
        options={{ headerShown: false }}
      />
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
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="bid-detail"
        options={{
          title: "Bid Details",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="post-bid"
        options={{
          title: "Post a Bid",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="company-detail"
        options={{
          title: "Company",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="company-profile"
        options={{
          title: "Company Profile",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="job-detail"
        options={{
          title: "Job Details",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="worker-detail"
        options={{
          title: "Worker Profile",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="post-job"
        options={{
          title: "Post a Job",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="messages"
        options={{
          title: "Messages",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="cash-flow"
        options={{
          title: "Cash Flow",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="integrations"
        options={{
          title: "Integrations",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="time-tracking"
        options={{
          title: "Time Tracking",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="documents"
        options={{
          title: "Documents",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="permits"
        options={{
          title: "Permits",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="weekly-snapshot"
        options={{
          title: "This Week",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
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
        name="report-inbox"
        options={{
          title: "Report Inbox",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="payments"
        options={{
          title: "Payments",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="aia-pay-app"
        options={{
          title: "AIA Pay Application",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="data-export"
        options={{
          title: "Export My Data",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="scope-sheet"
        options={{
          title: "Scope Sheet",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="connect-claude"
        options={{
          title: "Connect Claude",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="data-import"
        options={{
          title: "Import Data",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="client-update"
        options={{
          title: "Weekly Client Update",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="client-messages"
        options={{
          title: "Messages",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen
        name="estimate-wizard"
        options={{
          title: "Quick Estimate",
          presentation: "modal",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
        }}
      />
      <Stack.Screen name="project-scope" options={{ headerShown: false }} />
      <Stack.Screen name="client-outbox" options={{ headerShown: false }} />
    </Stack>
  );
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
        const stored = await AsyncStorage.getItem('buildwise_settings');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.themeColors) {
            setCustomColors(parsed.themeColors.primary, parsed.themeColors.accent);
            console.log('[Theme] Loaded custom colors:', parsed.themeColors.primary);
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

  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync();
      return;
    }
    // Failsafe: hide splash after 1.2s even if fonts haven't loaded.
    // Onboarding falls back to Georgia / serif so it remains usable.
    const timer = setTimeout(() => { void SplashScreen.hideAsync(); }, 1200);
    return () => clearTimeout(timer);
  }, [fontsLoaded]);

  return (
    <ErrorBoundary fallbackMessage="MAGE ID encountered an error. Tap below to restart.">
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <ThemeLoader>
            <ThemeProvider>
            <AuthProvider>
              <SubscriptionProvider>
                <ProjectProvider>
                  <PropertyProvider>
                  <MaterialCartProvider>
                    <BidsProvider>
                      <CompaniesProvider>
                        <HireProvider>
                          <NotificationProvider>
                            <SearchProvider>
                              <MagicLinkHandler />
                              <AnalyticsManager />
                              <OfflineSyncManager />
                              <MarginAlertManager />
                              <RootLayoutNav />
                              <UniversalSearch />
                              <SearchHotkeyListener />
                              <NailItToastHost />
                              <ConfettiHost />
                            </SearchProvider>
                          </NotificationProvider>
                        </HireProvider>
                      </CompaniesProvider>
                    </BidsProvider>
                  </MaterialCartProvider>
                  </PropertyProvider>
                </ProjectProvider>
              </SubscriptionProvider>
            </AuthProvider>
            </ThemeProvider>
          </ThemeLoader>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
});
