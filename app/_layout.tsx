import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { AppState, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ConstructionLoader from "@/components/ConstructionLoader";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProjectProvider, useProjects } from "@/contexts/ProjectContext";
import { SubscriptionProvider, useSubscription } from "@/contexts/SubscriptionContext";
import { BidsProvider } from "@/contexts/BidsContext";
import { CompaniesProvider } from "@/contexts/CompaniesContext";
import { HireProvider } from "@/contexts/HireContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { SearchProvider, useSearch } from "@/contexts/SearchContext";
import UniversalSearch from "@/components/UniversalSearch";
import { NailItToastHost } from "@/components/animations/NailItToast";
import { Colors, setCustomColors } from "@/constants/colors";
import ErrorBoundary from "@/components/ErrorBoundary";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { processOfflineQueue } from "@/utils/offlineQueue";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";

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
  const { hasSeenOnboarding, isLoading: projectLoading } = useProjects();
  const { tier } = useSubscription();
  const paywallGateRanRef = useRef(false);

  useEffect(() => {
    if (authLoading || projectLoading || hasSeenOnboarding === null) return;

    const inAuth = segments[0] === 'login' || segments[0] === 'signup';
    const inOnboarding = segments[0] === 'onboarding';
    const inOnboardingPaywall = (segments[0] as string) === 'onboarding-paywall';
    const inResetPassword = segments[0] === 'reset-password';
    const inPrequalForm = segments[0] === 'prequal-form';

    // Public magic-link destinations: never redirect away from these, even
    // when the user is unauthenticated. The prequal-form route is opened by
    // subcontractors via a tokenized email link; if we redirect to /login
    // before the token is consumed, the link is dead on arrival.
    if (inResetPassword || inPrequalForm) return;

    if (!isAuthenticated && !inAuth) {
      console.log('[Layout] Not authenticated — redirecting to login');
      router.replace('/login');
      return;
    }

    if (isAuthenticated && !hasSeenOnboarding && !inOnboarding && !inOnboardingPaywall) {
      console.log('[Layout] First launch — redirecting to onboarding');
      router.replace('/onboarding');
      return;
    }

    if (isAuthenticated && inAuth) {
      console.log('[Layout] Already authenticated — redirecting to home');
      router.replace('/(tabs)/summary' as any);
      return;
    }

    // 3-day free-tier paywall re-show gate. Runs at most once per
    // mount — if the user dismisses we don't re-queue it mid-session,
    // only on the next cold boot. Gate only fires when we've resolved
    // a concrete tier; while tier is still hydrating from RC, skip.
    if (
      isAuthenticated &&
      hasSeenOnboarding &&
      tier === 'free' &&
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
  }, [isAuthenticated, hasSeenOnboarding, authLoading, projectLoading, segments, router, tier]);

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
        name="prequal-manager"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="prequal-form"
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

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <ErrorBoundary fallbackMessage="MAGE ID encountered an error. Tap below to restart.">
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <ThemeLoader>
            <AuthProvider>
              <SubscriptionProvider>
                <ProjectProvider>
                  <BidsProvider>
                    <CompaniesProvider>
                      <HireProvider>
                        <NotificationProvider>
                          <SearchProvider>
                            <MagicLinkHandler />
                            <OfflineSyncManager />
                            <RootLayoutNav />
                            <UniversalSearch />
                            <SearchHotkeyListener />
                            <NailItToastHost />
                          </SearchProvider>
                        </NotificationProvider>
                      </HireProvider>
                    </CompaniesProvider>
                  </BidsProvider>
                </ProjectProvider>
              </SubscriptionProvider>
            </AuthProvider>
          </ThemeLoader>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
