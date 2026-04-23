# Foundations — Routing, Layouts & Desktop Shell


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

The provider stack, tab routing, and desktop sidebar live here. Read
this bundle second.

- `app/_layout.tsx` is the single root. It mounts the provider stack
  (QueryClient → GestureHandler → Theme → Auth → Subscription → Project →
  Bids → Companies → Hire → Notification → OfflineSyncManager → RootLayoutNav)
  and declares every `Stack.Screen` (30+ routes). Context order matters:
  anything below Auth gets the current user.
- `app/(tabs)/_layout.tsx` defines the mobile bottom-tab bar; hidden routes
  use `href: null`.
- `components/DesktopSidebar.tsx` is the primary nav on wide screens.
  Keep the sidebar in sync with the tab bar when adding/removing destinations.
- `app/+native-intent.tsx` and `app/+not-found.tsx` handle deep-link intents
  and unmatched routes.


## Files in this bundle

- `app/_layout.tsx`
- `app/(tabs)/_layout.tsx`
- `app/(tabs)/(home)/_layout.tsx`
- `app/(tabs)/bids/_layout.tsx`
- `app/(tabs)/companies/_layout.tsx`
- `app/(tabs)/construction-ai/_layout.tsx`
- `app/(tabs)/equipment/_layout.tsx`
- `app/(tabs)/estimate/_layout.tsx`
- `app/(tabs)/hire/_layout.tsx`
- `app/(tabs)/marketplace/_layout.tsx`
- `app/(tabs)/materials/_layout.tsx`
- `app/(tabs)/schedule/_layout.tsx`
- `app/(tabs)/settings/_layout.tsx`
- `app/(tabs)/subs/_layout.tsx`
- `app/(tabs)/summary/_layout.tsx`
- `components/DesktopSidebar.tsx`
- `app/+native-intent.tsx`
- `app/+not-found.tsx`
- `utils/useResponsiveLayout.ts`
- `utils/useWebEnhancements.ts`


---

### `app/_layout.tsx`

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { AppState, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ConstructionLoader from "@/components/ConstructionLoader";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProjectProvider, useProjects } from "@/contexts/ProjectContext";
import { SubscriptionProvider, useSubscription } from "@/contexts/SubscriptionContext";
import { BidsProvider } from "@/contexts/BidsContext";
import { CompaniesProvider } from "@/contexts/CompaniesContext";
import { HireProvider } from "@/contexts/HireContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { Colors, setCustomColors } from "@/constants/colors";
import ErrorBoundary from "@/components/ErrorBoundary";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { processOfflineQueue } from "@/utils/offlineQueue";

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

    if (inResetPassword) return;

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
      router.replace('/(tabs)/(home)');
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
                          <OfflineSyncManager />
                          <RootLayoutNav />
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

```


---

### `app/(tabs)/_layout.tsx`

```tsx
import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Tabs, Slot } from 'expo-router';
import { Home, Compass, Settings, LayoutDashboard } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import DesktopSidebar from '@/components/DesktopSidebar';

export default function TabLayout() {
  const layout = useResponsiveLayout();

  if (layout.showSidebar) {
    return (
      <View style={styles.desktopContainer}>
        <DesktopSidebar width={layout.sidebarWidth} />
        <View style={styles.desktopContent}>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarStyle: { display: 'none' },
            }}
          >
            <Tabs.Screen name="summary" options={{ title: 'Summary' }} />
            <Tabs.Screen name="(home)" options={{ title: 'Your Projects' }} />
            <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
            <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
            <Tabs.Screen name="construction-ai" options={{ href: null }} />
            <Tabs.Screen name="bids" options={{ href: null }} />
            <Tabs.Screen name="companies" options={{ href: null }} />
            <Tabs.Screen name="hire" options={{ href: null }} />
            <Tabs.Screen name="estimate" options={{ href: null }} />
            <Tabs.Screen name="materials" options={{ href: null }} />
            <Tabs.Screen name="schedule" options={{ href: null }} />
            <Tabs.Screen name="marketplace" options={{ href: null }} />
            <Tabs.Screen name="subs" options={{ href: null }} />
            <Tabs.Screen name="equipment" options={{ href: null }} />
          </Tabs>
        </View>
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.borderLight,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          letterSpacing: 0.2,
          marginBottom: Platform.OS === 'ios' ? 0 : 4,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="summary"
        options={{
          title: 'Summary',
          tabBarIcon: ({ color, focused }) => (
            <LayoutDashboard size={23} color={color} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="(home)"
        options={{
          title: 'Your Projects',
          tabBarIcon: ({ color, focused }) => (
            <Home size={23} color={color} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, focused }) => (
            <Compass size={23} color={color} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Settings size={23} color={color} strokeWidth={focused ? 2.2 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen name="bids" options={{ href: null }} />
      <Tabs.Screen name="companies" options={{ href: null }} />
      <Tabs.Screen name="hire" options={{ href: null }} />
      <Tabs.Screen name="estimate" options={{ href: null }} />
      <Tabs.Screen name="materials" options={{ href: null }} />
      <Tabs.Screen name="schedule" options={{ href: null }} />
      <Tabs.Screen name="marketplace" options={{ href: null }} />
      <Tabs.Screen name="subs" options={{ href: null }} />
      <Tabs.Screen name="equipment" options={{ href: null }} />
      <Tabs.Screen name="construction-ai" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  desktopContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopContent: {
    flex: 1,
  },
});

```


---

### `app/(tabs)/(home)/_layout.tsx`

```tsx
import { Stack } from 'expo-router';

export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}

```


---

### `app/(tabs)/bids/_layout.tsx`

```tsx
import { Stack } from 'expo-router';
export default function BidsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

```


---

### `app/(tabs)/companies/_layout.tsx`

```tsx
import { Stack } from 'expo-router';
export default function CompaniesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

```


---

### `app/(tabs)/construction-ai/_layout.tsx`

```tsx
import { Stack } from 'expo-router';

export default function ConstructionAILayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

```


---

### `app/(tabs)/equipment/_layout.tsx`

```tsx
import { Stack } from 'expo-router';

export default function EquipmentLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

```


---

### `app/(tabs)/estimate/_layout.tsx`

```tsx
import { Stack } from 'expo-router';

export default function EstimateLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}

```


---

### `app/(tabs)/hire/_layout.tsx`

```tsx
import { Stack } from 'expo-router';
export default function HireLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

```


---

### `app/(tabs)/marketplace/_layout.tsx`

```tsx
import { Stack } from 'expo-router';

export default function MarketplaceLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

```


---

### `app/(tabs)/materials/_layout.tsx`

```tsx
import { Stack } from 'expo-router';

export default function MaterialsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}

```


---

### `app/(tabs)/schedule/_layout.tsx`

```tsx
import { Stack } from 'expo-router';

export default function ScheduleLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}

```


---

### `app/(tabs)/settings/_layout.tsx`

```tsx
import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}

```


---

### `app/(tabs)/subs/_layout.tsx`

```tsx
import { Stack } from 'expo-router';
export default function SubsLayout() { return <Stack screenOptions={{ headerShown: false }} />; }

```


---

### `app/(tabs)/summary/_layout.tsx`

```tsx
import { Stack } from 'expo-router';
export default function SummaryLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

```


---

### `components/DesktopSidebar.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Home, Compass, Wrench, Settings, BarChart3, CalendarDays,
  Hammer, FileText, Building2, Search, HardHat, Gavel, LayoutDashboard,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface NavItem {
  key: string;
  label: string;
  icon: typeof Home;
  route: string;
  section: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'summary', label: 'Summary', icon: LayoutDashboard, route: '/(tabs)/summary', section: 'PROJECT' },
  { key: 'home', label: 'Projects', icon: Home, route: '/(tabs)/(home)', section: 'PROJECT' },
  { key: 'estimate', label: 'Estimate', icon: BarChart3, route: '/(tabs)/discover/estimate', section: 'PROJECT' },
  { key: 'schedule', label: 'Schedule', icon: CalendarDays, route: '/(tabs)/discover/schedule', section: 'PROJECT' },
  { key: 'equipment', label: 'Equipment', icon: Hammer, route: '/(tabs)/equipment', section: 'FIELD' },
  { key: 'bids', label: 'Bids', icon: FileText, route: '/(tabs)/bids', section: 'FIELD' },
  { key: 'companies', label: 'Companies', icon: Building2, route: '/(tabs)/companies', section: 'NETWORK' },
  { key: 'discover', label: 'Discover', icon: Search, route: '/(tabs)/discover', section: 'NETWORK' },
  { key: 'hire', label: 'Hire', icon: HardHat, route: '/(tabs)/hire', section: 'NETWORK' },
  { key: 'construction-ai', label: 'Construction AI', icon: Gavel, route: '/(tabs)/construction-ai', section: 'NETWORK' },
  { key: 'settings', label: 'Settings', icon: Settings, route: '/(tabs)/settings', section: 'ACCOUNT' },
];

const SECTIONS = ['PROJECT', 'FIELD', 'NETWORK', 'ACCOUNT'];

function isActiveRoute(pathname: string, navKey: string): boolean {
  if (navKey === 'summary') return pathname.includes('summary');
  if (navKey === 'home') return pathname === '/' || pathname.includes('(home)');
  if (navKey === 'estimate') return pathname.includes('estimate');
  if (navKey === 'schedule') return pathname.includes('schedule');
  if (navKey === 'equipment') return pathname.includes('equipment');
  if (navKey === 'bids') return pathname.includes('bids');
  if (navKey === 'construction-ai') return pathname.includes('construction-ai');
  if (navKey === 'companies') return pathname.includes('companies');
  if (navKey === 'discover') return pathname.includes('discover');
  if (navKey === 'hire') return pathname.includes('hire');
  if (navKey === 'settings') return pathname.includes('settings');
  return false;
}

interface DesktopSidebarProps {
  width: number;
}

const DesktopSidebar = React.memo(function DesktopSidebar({ width }: DesktopSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const handleNav = useCallback((route: string) => {
    router.push(route as any);
  }, [router]);

  const groupedItems = SECTIONS.map(section => ({
    section,
    items: NAV_ITEMS.filter(item => item.section === section),
  }));

  return (
    <View style={[styles.container, { width, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.brandSection}>
        <View style={styles.brandIcon}>
          <Wrench size={20} color={Colors.textOnPrimary} />
        </View>
        <Text style={styles.brandName}>MAGE ID</Text>
        <Text style={styles.brandTagline}>Construction Suite</Text>
      </View>

      <ScrollView style={styles.navScroll} showsVerticalScrollIndicator={false}>
        {groupedItems.map(({ section, items }) => (
          <View key={section} style={styles.navSection}>
            <Text style={styles.sectionLabel}>{section}</Text>
            {items.map(item => {
              const active = isActiveRoute(pathname, item.key);
              const hovered = hoveredKey === item.key;
              const Icon = item.icon;

              return (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.navItem,
                    active && styles.navItemActive,
                    hovered && !active && styles.navItemHovered,
                  ]}
                  onPress={() => handleNav(item.route)}
                  activeOpacity={0.7}
                  {...(Platform.OS === 'web' ? {
                    onMouseEnter: () => setHoveredKey(item.key),
                    onMouseLeave: () => setHoveredKey(null),
                  } as any : {})}
                  testID={`sidebar-${item.key}`}
                >
                  {active && <View style={styles.activeIndicator} />}
                  <Icon
                    size={18}
                    color={active ? Colors.primary : hovered ? Colors.text : Colors.textSecondary}
                    strokeWidth={active ? 2.2 : 1.8}
                  />
                  <Text style={[
                    styles.navLabel,
                    active && styles.navLabelActive,
                    hovered && !active && styles.navLabelHovered,
                  ]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerDivider} />
        <Text style={styles.footerText}>MAGE ID v2.0</Text>
        <Text style={styles.footerSubtext}>Desktop Mode</Text>
      </View>
    </View>
  );
});

export default DesktopSidebar;

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1C1C1E',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
  },
  brandSection: {
    alignItems: 'center' as const,
    paddingBottom: 20,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 8,
  },
  brandName: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  brandTagline: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500' as const,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  navScroll: {
    flex: 1,
  },
  navSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 1.2,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 2,
    position: 'relative' as const,
  },
  navItemActive: {
    backgroundColor: Colors.primary + '15',
  },
  navItemHovered: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  activeIndicator: {
    position: 'absolute' as const,
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  navLabel: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: 'rgba(255,255,255,0.6)',
  },
  navLabelActive: {
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  navLabelHovered: {
    color: '#FFFFFF',
  },
  footer: {
    alignItems: 'center' as const,
    paddingTop: 12,
  },
  footerDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignSelf: 'stretch' as const,
    marginBottom: 12,
  },
  footerText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 0.5,
  },
  footerSubtext: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.15)',
    marginTop: 2,
  },
});

```


---

### `app/+native-intent.tsx`

```tsx
export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  return '/';
}

```


---

### `app/+not-found.tsx`

```tsx
import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/constants/colors";
import { AlertTriangle } from "lucide-react-native";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not Found" }} />
      <View style={styles.container}>
        <View style={styles.iconContainer}>
          <AlertTriangle size={32} color={Colors.accent} />
        </View>
        <Text style={styles.title}>Page Not Found</Text>
        <Text style={styles.subtitle}>This screen doesn&apos;t exist.</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go to Home</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: Colors.background,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.warningLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 24,
  },
  link: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  linkText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.textOnPrimary,
  },
});

```


---

### `utils/useResponsiveLayout.ts`

```ts
import { useState, useEffect, useMemo } from 'react';
import { Dimensions, Platform, type ScaledSize } from 'react-native';

export type ScreenSize = 'phone' | 'tablet' | 'desktop';

export interface ResponsiveLayout {
  screenSize: ScreenSize;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
  height: number;
  contentMaxWidth: number;
  sidebarWidth: number;
  showSidebar: boolean;
  ganttRowHeight: number;
  cardColumns: number;
  fontSize: {
    title: number;
    heading: number;
    body: number;
    caption: number;
  };
  spacing: {
    page: number;
    section: number;
    card: number;
  };
}

export function useResponsiveLayout(): ResponsiveLayout {
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));

  useEffect(() => {
    const handler = ({ window }: { window: ScaledSize; screen: ScaledSize }) => {
      setDimensions(window);
    };
    const subscription = Dimensions.addEventListener('change', handler);
    return () => subscription.remove();
  }, []);

  const { width, height } = dimensions;
  const isWeb = Platform.OS === 'web';

  return useMemo(() => {
    let screenSize: ScreenSize = 'phone';
    if (width >= 1024 || (isWeb && width >= 900)) {
      screenSize = 'desktop';
    } else if (width >= 768) {
      screenSize = 'tablet';
    }

    const isPhone = screenSize === 'phone';
    const isTablet = screenSize === 'tablet';
    const isDesktop = screenSize === 'desktop';

    return {
      screenSize,
      isPhone,
      isTablet,
      isDesktop,
      width,
      height,
      contentMaxWidth: isDesktop ? 1400 : isTablet ? 900 : width,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
      cardColumns: isDesktop ? 3 : isTablet ? 2 : 1,
      fontSize: {
        title: isDesktop ? 32 : isTablet ? 28 : 24,
        heading: isDesktop ? 20 : isTablet ? 18 : 16,
        body: isDesktop ? 15 : 14,
        caption: isDesktop ? 13 : 12,
      },
      spacing: {
        page: isDesktop ? 32 : isTablet ? 24 : 16,
        section: isDesktop ? 24 : isTablet ? 20 : 16,
        card: isDesktop ? 16 : 12,
      },
    };
  }, [width, height, isWeb]);
}

```


---

### `utils/useWebEnhancements.ts`

```ts
import { useEffect, useCallback } from 'react';
import { Platform } from 'react-native';

interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  handler: () => void;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[], enabled: boolean = true) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : true;
        const shiftMatch = shortcut.shift ? e.shiftKey : true;
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

        if (ctrlMatch && shiftMatch && keyMatch) {
          if (shortcut.ctrl || shortcut.meta) {
            e.preventDefault();
          }
          shortcut.handler();
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, enabled]);
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.title = title;
  }, [title]);
}

export function useWebCursor(ref: React.RefObject<any>, cursor: string) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current) return;
    const element = ref.current as unknown as HTMLElement;
    if (element && element.style) {
      element.style.cursor = cursor;
    }
  }, [ref, cursor]);
}

export function getHoverProps(onHoverIn?: () => void, onHoverOut?: () => void) {
  if (Platform.OS !== 'web') return {};
  return {
    onMouseEnter: onHoverIn,
    onMouseLeave: onHoverOut,
  } as any;
}

```
