# Contexts — Cross-Screen Domain State


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

All domain state providers, built with `@nkzw/create-context-hook`
(`createContextHook`) which generates a `Provider` + typed hook pair. Provider
order is defined in `app/_layout.tsx`:

```
Auth → Subscription → Project → Bids → Companies → Hire → Notification
```

Highlights:
- **`ProjectContext`**: central project store. Owns `projects`, the `linkedEstimate`
  draw-down logic, and all `tertiary_*` sub-collections (change orders, invoices,
  daily reports, punch items, photos, RFIs, submittals, warranties, portal
  messages). All writes go through `utils/offlineQueue.ts` so they survive
  dropped connections.
- **`SubscriptionContext`**: RevenueCat tiers (free / Pro / Business). Features
  gate through `hooks/useTierAccess.ts`, never through raw entitlements.
- **`AuthContext`**: Supabase auth session + user object.


## Files in this bundle

- `contexts/AuthContext.tsx`
- `contexts/SubscriptionContext.tsx`
- `contexts/ProjectContext.tsx`
- `contexts/BidsContext.tsx`
- `contexts/CompaniesContext.tsx`
- `contexts/HireContext.tsx`
- `contexts/NotificationContext.tsx`
- `hooks/useTierAccess.ts`


---

### `contexts/AuthContext.tsx`

```tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Platform, Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { supabase } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import type { Session, User } from '@supabase/supabase-js';

WebBrowser.maybeCompleteAuthSession();

const AUTH_EMAIL_KEY = 'mageid_auth_email';
const AUTH_PASSWORD_KEY = 'mageid_auth_password';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

function mapSupabaseUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email ?? '',
    name: user.user_metadata?.name ?? user.email?.split('@')[0] ?? '',
  };
}

async function saveCredentials(email: string, password: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(AUTH_EMAIL_KEY, email);
    await SecureStore.setItemAsync(AUTH_PASSWORD_KEY, password);
    console.log('[Auth] Credentials saved to SecureStore');
  } catch (err) {
    console.log('[Auth] Failed to save credentials:', err);
  }
}

async function getStoredCredentials(): Promise<{ email: string; password: string } | null> {
  try {
    const email = await SecureStore.getItemAsync(AUTH_EMAIL_KEY);
    const password = await SecureStore.getItemAsync(AUTH_PASSWORD_KEY);
    if (email && password) return { email, password };
    return null;
  } catch {
    return null;
  }
}

async function clearStoredCredentials(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(AUTH_EMAIL_KEY);
    await SecureStore.deleteItemAsync(AUTH_PASSWORD_KEY);
    console.log('[Auth] Stored credentials cleared');
  } catch (err) {
    console.log('[Auth] Failed to clear credentials:', err);
  }
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasStoredCredentials, setHasStoredCredentials] = useState(false);

  useEffect(() => {
    console.log('[Auth] Initializing Supabase auth listener');

    void supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      console.log('[Auth] Initial session:', currentSession ? 'found' : 'none');
      if (currentSession?.user) {
        setSession(currentSession);
        setUser(mapSupabaseUser(currentSession.user));
        setIsAuthenticated(true);
      }
      setIsLoading(false);
    }).catch((err) => {
      console.log('[Auth] Failed to get initial session (network error):', err);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      console.log('[Auth] Auth state changed:', _event);
      if (newSession?.user) {
        setSession(newSession);
        setUser(mapSupabaseUser(newSession.user));
        setIsAuthenticated(true);
      } else {
        setSession(null);
        setUser(null);
        setIsAuthenticated(false);
      }
    });

    void getStoredCredentials().then(creds => {
      setHasStoredCredentials(!!creds);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string, rememberMe: boolean = true) => {
    console.log('[Auth] Logging in:', email);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });

    if (error) {
      console.log('[Auth] Login error:', error.message);
      throw new Error(error.message);
    }

    if (rememberMe) {
      await saveCredentials(email.toLowerCase().trim(), password);
      setHasStoredCredentials(true);
    }

    const authUser = mapSupabaseUser(data.user);
    queryClient.clear();
    console.log('[Auth] Login successful');
    return authUser;
  }, [queryClient]);

  const signup = useCallback(async (email: string, password: string, name: string) => {
    console.log('[Auth] Signing up:', email);
    const { data, error } = await supabase.auth.signUp({
      email: email.toLowerCase().trim(),
      password,
      options: {
        data: { name },
      },
    });

    if (error) {
      console.log('[Auth] Signup error:', error.message);
      throw new Error(error.message);
    }

    if (!data.user) {
      throw new Error('Signup succeeded but no user returned. Check your email for verification.');
    }

    const authUser = mapSupabaseUser(data.user);
    queryClient.clear();
    console.log('[Auth] Signup successful');
    return authUser;
  }, [queryClient]);

  const loginWithBiometrics = useCallback(async () => {
    if (Platform.OS === 'web') {
      throw new Error('Biometric login is not available on web.');
    }

    const creds = await getStoredCredentials();
    if (!creds) {
      throw new Error('No stored credentials found. Please log in with email/password first.');
    }

    const LocalAuth = await import('expo-local-authentication');
    const result = await LocalAuth.authenticateAsync({
      promptMessage: 'Sign in to MAGE ID',
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Password',
      disableDeviceFallback: false,
    });

    if (!result.success) {
      throw new Error('Biometric authentication cancelled or failed.');
    }

    return login(creds.email, creds.password, true);
  }, [login]);

  const logout = useCallback(async (clearCredentials: boolean = false) => {
    console.log('[Auth] Logging out');
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.log('[Auth] Logout error:', error.message);
    }

    if (clearCredentials) {
      await clearStoredCredentials();
      setHasStoredCredentials(false);
    }

    setSession(null);
    setUser(null);
    setIsAuthenticated(false);
    queryClient.clear();
    console.log('[Auth] Logged out');
  }, [queryClient]);

  const resetPassword = useCallback(async (email: string) => {
    console.log('[Auth] Sending password reset email to:', email);
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.toLowerCase().trim(),
      { redirectTo: 'mageid://reset-password' }
    );

    if (error) {
      console.log('[Auth] Password reset error:', error.message);
      throw new Error(error.message);
    }
    console.log('[Auth] Password reset email sent');
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    console.log('[Auth] Updating password');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      console.log('[Auth] Password update error:', error.message);
      throw new Error(error.message);
    }
    console.log('[Auth] Password updated');
  }, []);

  const signInWithGoogle = useCallback(async () => {
    console.log('[Auth] Starting Google sign-in');
    try {
      const redirectUrl = makeRedirectUri({ preferLocalhost: false });
      console.log('[Auth] Google redirect URL:', redirectUrl);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
        console.log('[Auth] Google auth result type:', result.type);
        if (result.type === 'success' && result.url) {
          const url = new URL(result.url);
          const accessToken = url.searchParams.get('access_token') || url.hash?.match(/access_token=([^&]*)/)?.[1];
          const refreshToken = url.searchParams.get('refresh_token') || url.hash?.match(/refresh_token=([^&]*)/)?.[1];
          if (accessToken) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            });
            if (sessionError) throw sessionError;
            console.log('[Auth] Google sign-in session set successfully');
            queryClient.clear();
          } else {
            console.log('[Auth] No access token found in Google callback URL');
          }
        }
      }
    } catch (err) {
      console.error('[Auth] Google sign-in error:', err);
      Alert.alert('Sign In Failed', 'Could not sign in with Google. Please try again.');
      throw err;
    }
  }, [queryClient]);

  const signInWithApple = useCallback(async () => {
    console.log('[Auth] Starting Apple sign-in');
    try {
      const redirectUrl = makeRedirectUri({ preferLocalhost: false });
      console.log('[Auth] Apple redirect URL:', redirectUrl);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
        console.log('[Auth] Apple auth result type:', result.type);
        if (result.type === 'success' && result.url) {
          const url = new URL(result.url);
          const accessToken = url.searchParams.get('access_token') || url.hash?.match(/access_token=([^&]*)/)?.[1];
          const refreshToken = url.searchParams.get('refresh_token') || url.hash?.match(/refresh_token=([^&]*)/)?.[1];
          if (accessToken) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            });
            if (sessionError) throw sessionError;
            console.log('[Auth] Apple sign-in session set successfully');
            queryClient.clear();
          } else {
            console.log('[Auth] No access token found in Apple callback URL');
          }
        }
      }
    } catch (err) {
      console.error('[Auth] Apple sign-in error:', err);
      Alert.alert('Sign In Failed', 'Could not sign in with Apple. Please try again.');
      throw err;
    }
  }, [queryClient]);

  return useMemo(() => ({
    user,
    session,
    isLoading,
    isAuthenticated,
    hasStoredCredentials,
    login,
    signup,
    logout,
    loginWithBiometrics,
    resetPassword,
    updatePassword,
    signInWithGoogle,
    signInWithApple,
  }), [user, session, isLoading, isAuthenticated, hasStoredCredentials, login, signup, logout, loginWithBiometrics, resetPassword, updatePassword, signInWithGoogle, signInWithApple]);
});

```


---

### `contexts/SubscriptionContext.tsx`

```tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import Purchases, {
  PurchasesOfferings,
  PurchasesPackage,
  CustomerInfo,
  LOG_LEVEL,
} from 'react-native-purchases';
import createContextHook from '@nkzw/create-context-hook';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { SubscriptionTier } from '@/types';

const SUBSCRIPTION_KEY = 'mageid_subscription_tier';

function getRCApiKey(): string | undefined {
  if (__DEV__ || Platform.OS === 'web') {
    return process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
  }
  return Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
    default: process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY,
  });
}

let rcConfigured = false;

function configureRC() {
  if (rcConfigured) return;
  const apiKey = getRCApiKey();
  if (!apiKey) {
    console.log('[RC] No RevenueCat API key found, skipping configuration');
    return;
  }
  try {
    void Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey });
    rcConfigured = true;
    console.log('[RC] RevenueCat configured successfully');
  } catch (err) {
    console.log('[RC] Failed to configure RevenueCat:', err);
  }
}

configureRC();

function tierFromCustomerInfo(info: CustomerInfo): SubscriptionTier {
  if (info.entitlements.active['business']?.isActive) return 'business';
  if (info.entitlements.active['pro']?.isActive) return 'pro';
  return 'free';
}

async function syncTierToSupabase(userId: string, newTier: SubscriptionTier, rcCustomerId?: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('subscriptions').upsert({
      user_id: userId,
      tier: newTier,
      revenuecat_customer_id: rcCustomerId ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    console.log('[Subscription] Synced tier to Supabase:', newTier);
  } catch (err) {
    console.log('[Subscription] Failed to sync tier to Supabase:', err);
  }
}

export const [SubscriptionProvider, useSubscription] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [tier, setTier] = useState<SubscriptionTier>('free');

  const customerInfoQuery = useQuery<CustomerInfo | null>({
    queryKey: ['rc-customer-info'],
    queryFn: async () => {
      if (!rcConfigured) {
        console.log('[RC] Not configured, falling back to local storage');
        return null;
      }
      try {
        const info = await Purchases.getCustomerInfo();
        console.log('[RC] Got customer info, active entitlements:', Object.keys(info.entitlements.active));
        return info;
      } catch (err) {
        console.log('[RC] Failed to get customer info:', err);
        return null;
      }
    },
    staleTime: 1000 * 60 * 5,
  });

  const localTierQuery = useQuery({
    queryKey: ['subscription-local'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(SUBSCRIPTION_KEY);
      console.log('[Subscription] Local tier:', stored);
      return (stored as SubscriptionTier) ?? 'free';
    },
  });

  const supabaseTierQuery = useQuery({
    queryKey: ['subscription-supabase', userId],
    queryFn: async () => {
      if (!userId || !isSupabaseConfigured) return null;
      try {
        const { data, error } = await supabase
          .from('subscriptions')
          .select('tier, revenuecat_customer_id')
          .eq('user_id', userId)
          .single();
        if (!error && data) {
          return data.tier as SubscriptionTier;
        }
      } catch { /* ok */ }
      return null;
    },
    enabled: !!userId,
  });

  useEffect(() => {
    let resolved: SubscriptionTier = 'free';

    if (customerInfoQuery.data) {
      resolved = tierFromCustomerInfo(customerInfoQuery.data);
      console.log('[RC] Resolved tier from entitlements:', resolved);

      if (supabaseTierQuery.data && supabaseTierQuery.data !== resolved && userId) {
        console.log('[Subscription] Supabase tier mismatch, trusting RevenueCat:', resolved, 'vs', supabaseTierQuery.data);
        void syncTierToSupabase(userId, resolved);
      }
    } else if (supabaseTierQuery.data) {
      resolved = supabaseTierQuery.data;
    } else if (localTierQuery.data) {
      resolved = localTierQuery.data;
    }

    setTier(resolved);
    void AsyncStorage.setItem(SUBSCRIPTION_KEY, resolved);
  }, [customerInfoQuery.data, localTierQuery.data, supabaseTierQuery.data, userId]);

  useEffect(() => {
    if (!rcConfigured) return;
    const listener = (info: CustomerInfo) => {
      console.log('[RC] Customer info updated via listener');
      const newTier = tierFromCustomerInfo(info);
      setTier(newTier);
      void AsyncStorage.setItem(SUBSCRIPTION_KEY, newTier);
      queryClient.setQueryData(['rc-customer-info'], info);
      if (userId) {
        void syncTierToSupabase(userId, newTier, info.originalAppUserId);
      }
    };
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, [queryClient, userId]);

  const offeringsQuery = useQuery<PurchasesOfferings | null>({
    queryKey: ['rc-offerings'],
    queryFn: async () => {
      if (!rcConfigured) return null;
      try {
        const offerings = await Purchases.getOfferings();
        console.log('[RC] Offerings fetched:', offerings.current?.identifier);
        return offerings;
      } catch (err) {
        console.log('[RC] Failed to get offerings:', err);
        return null;
      }
    },
    staleTime: 1000 * 60 * 10,
  });

  const purchaseMutation = useMutation({
    mutationFn: async (pkg: PurchasesPackage) => {
      console.log('[RC] Purchasing package:', pkg.identifier);
      const result = await Purchases.purchasePackage(pkg);
      return result;
    },
    onSuccess: async (data) => {
      const newTier = tierFromCustomerInfo(data.customerInfo);
      console.log('[RC] Purchase successful, new tier:', newTier);
      // Update UI state synchronously so any subscriber re-renders this frame.
      setTier(newTier);
      void AsyncStorage.setItem(SUBSCRIPTION_KEY, newTier);
      // Prime the RC query cache with the fresh CustomerInfo, then invalidate so
      // any screen that reads from the query (Settings plan row, paywall, gated
      // features) refetches and stays in sync even if it mounted after purchase.
      queryClient.setQueryData(['rc-customer-info'], data.customerInfo);
      await queryClient.invalidateQueries({ queryKey: ['rc-customer-info'] });
      if (userId) {
        await syncTierToSupabase(userId, newTier, data.customerInfo.originalAppUserId);
        // Also refresh the Supabase mirror so cross-device tier is consistent.
        await queryClient.invalidateQueries({ queryKey: ['subscription-supabase', userId] });
      }
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      if (!rcConfigured) {
        const stored = await AsyncStorage.getItem(SUBSCRIPTION_KEY);
        return stored as SubscriptionTier ?? 'free';
      }
      const info = await Purchases.restorePurchases();
      console.log('[RC] Purchases restored');
      return tierFromCustomerInfo(info);
    },
    onSuccess: (restoredTier: SubscriptionTier) => {
      setTier(restoredTier);
      void AsyncStorage.setItem(SUBSCRIPTION_KEY, restoredTier);
      void queryClient.invalidateQueries({ queryKey: ['rc-customer-info'] });
    },
  });

  const proPackage = useMemo(() => {
    const packages = offeringsQuery.data?.current?.availablePackages ?? [];
    return packages.find((p) =>
      p.identifier === 'pro_monthly' ||
      p.identifier === '$rc_monthly' ||
      p.product?.identifier === 'com.mageid.pro.monthly'
    ) ?? null;
  }, [offeringsQuery.data]);

  const proAnnualPackage = useMemo(() => {
    const packages = offeringsQuery.data?.current?.availablePackages ?? [];
    return packages.find((p) =>
      p.identifier === 'pro_annual' ||
      p.identifier === '$rc_annual' ||
      p.product?.identifier === 'com.mageid.pro.annual'
    ) ?? null;
  }, [offeringsQuery.data]);

  const businessPackage = useMemo(() => {
    const packages = offeringsQuery.data?.current?.availablePackages ?? [];
    return packages.find((p) =>
      p.identifier === 'business_monthly' ||
      p.product?.identifier === 'com.mageid.business.monthly'
    ) ?? null;
  }, [offeringsQuery.data]);

  const businessAnnualPackage = useMemo(() => {
    const packages = offeringsQuery.data?.current?.availablePackages ?? [];
    return packages.find((p) =>
      p.identifier === 'business_annual' ||
      p.product?.identifier === 'com.mageid.business.annual'
    ) ?? null;
  }, [offeringsQuery.data]);

  const purchasePro = useCallback(async (period: 'monthly' | 'annual' = 'monthly') => {
    const pkg = period === 'annual' ? proAnnualPackage : proPackage;
    if (pkg) {
      await purchaseMutation.mutateAsync(pkg);
    } else {
      throw new Error('Subscription packages not available. Please try again later.');
    }
  }, [proPackage, proAnnualPackage, purchaseMutation]);

  const purchaseBusiness = useCallback(async (period: 'monthly' | 'annual' = 'monthly') => {
    const pkg = period === 'annual' ? businessAnnualPackage : businessPackage;
    if (pkg) {
      await purchaseMutation.mutateAsync(pkg);
    } else {
      throw new Error('Subscription packages not available. Please try again later.');
    }
  }, [businessPackage, businessAnnualPackage, purchaseMutation]);

  const restorePurchases = useCallback(async () => {
    await restoreMutation.mutateAsync();
  }, [restoreMutation]);

  const isProOrAbove = useMemo(() => tier === 'pro' || tier === 'business', [tier]);
  const isBusinessTier = useMemo(() => tier === 'business', [tier]);
  const isLoading = customerInfoQuery.isLoading || offeringsQuery.isLoading || purchaseMutation.isPending;

  return useMemo(() => ({
    tier,
    isProOrAbove,
    isBusinessTier,
    isLoading,
    purchasePro,
    purchaseBusiness,
    restorePurchases,
    proPackage,
    proAnnualPackage,
    businessPackage,
    businessAnnualPackage,
    offerings: offeringsQuery.data,
    isPurchasing: purchaseMutation.isPending,
    ...__DEV__ ? {
      setSubscriptionTier: (newTier: SubscriptionTier) => {
        console.log('[Subscription] DEV: Manually setting tier to:', newTier);
        setTier(newTier);
        void AsyncStorage.setItem(SUBSCRIPTION_KEY, newTier);
      },
    } : {},
  }), [
    tier, isProOrAbove, isBusinessTier, isLoading,
    purchasePro, purchaseBusiness, restorePurchases,
    proPackage, proAnnualPackage, businessPackage, businessAnnualPackage,
    offeringsQuery.data, purchaseMutation.isPending,
  ]);
});

export function useSubscriptionGate(requiredTier: 'pro' | 'business') {
  const { tier } = useSubscription();
  const { push } = useRouter();

  const canAccess = useMemo(() => {
    if (requiredTier === 'pro') return tier === 'pro' || tier === 'business';
    if (requiredTier === 'business') return tier === 'business';
    return false;
  }, [tier, requiredTier]);

  const showPaywall = useCallback(() => {
    push('/paywall');
  }, [push]);

  return { canAccess, requiredTier, currentTier: tier, showPaywall };
}

```


---

### `contexts/ProjectContext.tsx`

```tsx
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { Project, AppSettings, CompanyBranding, ProjectCollaborator, ChangeOrder, Invoice, DailyFieldReport, Subcontractor, PunchItem, ProjectPhoto, PriceAlert, Contact, CommunicationEvent, RFI, Submittal, SubmittalReviewCycle, Equipment, EquipmentUtilizationEntry, PDFNamingSettings, Warranty, WarrantyClaim, PortalMessage } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';

const PROJECTS_KEY = 'buildwise_projects';
const SETTINGS_KEY = 'buildwise_settings';
const ONBOARDING_KEY = 'buildwise_onboarding_complete';
const CHANGE_ORDERS_KEY = 'tertiary_change_orders';
const INVOICES_KEY = 'tertiary_invoices';
const DAILY_REPORTS_KEY = 'tertiary_daily_reports';
const SUBS_KEY = 'tertiary_subcontractors';
const PUNCH_ITEMS_KEY = 'tertiary_punch_items';
const PHOTOS_KEY = 'tertiary_photos';
const PRICE_ALERTS_KEY = 'tertiary_price_alerts';
const CONTACTS_KEY = 'tertiary_contacts';
const COMM_EVENTS_KEY = 'tertiary_comm_events';
const RFIS_KEY = 'tertiary_rfis';
const SUBMITTALS_KEY = 'tertiary_submittals';
const EQUIPMENT_KEY = 'tertiary_equipment';
const WARRANTIES_KEY = 'tertiary_warranties';
const PORTAL_MESSAGES_KEY = 'tertiary_portal_messages';

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  licenseNumber: '',
  tagline: '',
  logoUri: undefined,
  signatureData: undefined,
};

const DEFAULT_SETTINGS: AppSettings = {
  location: 'United States',
  units: 'imperial',
  taxRate: 7.5,
  contingencyRate: 10,
  branding: DEFAULT_BRANDING,
};

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function saveLocal(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.log('[ProjectContext] Local save failed for', key, err);
  }
}

export const [ProjectProvider, useProjects] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyFieldReport[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [punchItems, setPunchItems] = useState<PunchItem[]>([]);
  const [projectPhotos, setProjectPhotos] = useState<ProjectPhoto[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [commEvents, setCommEvents] = useState<CommunicationEvent[]>([]);
  const [rfis, setRfis] = useState<RFI[]>([]);
  const [submittals, setSubmittals] = useState<Submittal[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const syncDebounceMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const canSync = !!userId && isSupabaseConfigured;

  const projectsQuery = useQuery({
    queryKey: ['projects', userId],
    queryFn: async () => {
      console.log('[ProjectContext] Loading projects');
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('updated_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, name: r.name as string, type: r.type as string,
              location: (r.location as string) ?? '', squareFootage: Number(r.square_footage) || 0,
              quality: (r.quality as string) ?? 'standard', description: (r.description as string) ?? '',
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              estimate: r.estimate as Project['estimate'], schedule: r.schedule as Project['schedule'],
              linkedEstimate: r.linked_estimate as Project['linkedEstimate'],
              status: (r.status as Project['status']) ?? 'draft',
              collaborators: r.collaborators as ProjectCollaborator[] ?? [],
              clientPortal: r.client_portal as Project['clientPortal'],
              closedAt: r.closed_at as string | undefined, photoCount: Number(r.photo_count) || 0,
            })) as Project[];
            await saveLocal(PROJECTS_KEY, mapped);
            return mapped;
          }
        } catch (err) {
          console.log('[ProjectContext] Supabase fetch failed, falling back to local:', err);
        }
      }
      return loadLocal<Project[]>(PROJECTS_KEY, []);
    },
  });

  const settingsQuery = useQuery({
    queryKey: ['settings', userId],
    queryFn: async () => {
      console.log('[ProjectContext] Loading settings');
      if (canSync) {
        try {
          const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
          if (!error && data) {
            const s: AppSettings = {
              location: (data.location as string) ?? 'United States',
              units: ((data.units as string) ?? 'imperial') as 'imperial' | 'metric',
              taxRate: Number(data.tax_rate) || 7.5,
              contingencyRate: Number(data.contingency_rate) || 10,
              branding: {
                companyName: (data.company_name as string) ?? '', contactName: (data.contact_name as string) ?? '',
                email: (data.email as string) ?? '', phone: (data.phone as string) ?? '',
                address: (data.address as string) ?? '', licenseNumber: (data.license_number as string) ?? '',
                tagline: (data.tagline as string) ?? '', logoUri: data.logo_uri as string | undefined,
                signatureData: data.signature_data as string[] | undefined,
              },
              themeColors: data.theme_colors as AppSettings['themeColors'],
              biometricsEnabled: data.biometrics_enabled as boolean,
              dfrRecipients: data.dfr_recipients as string[],
            };
            await saveLocal(SETTINGS_KEY, s);
            return s;
          }
        } catch (err) {
          console.log('[ProjectContext] Supabase settings fetch failed:', err);
        }
      }
      return loadLocal<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
    },
  });

  const changeOrdersQuery = useQuery({
    queryKey: ['changeOrders', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('change_orders').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, number: Number(r.number), projectId: r.project_id as string,
              date: r.date as string, description: (r.description as string) ?? '',
              reason: (r.reason as string) ?? '', lineItems: r.line_items as ChangeOrder['lineItems'],
              originalContractValue: Number(r.original_contract_value), changeAmount: Number(r.change_amount),
              newContractTotal: Number(r.new_contract_total), status: r.status as ChangeOrder['status'],
              approvers: r.approvers as ChangeOrder['approvers'], approvalMode: r.approval_mode as ChangeOrder['approvalMode'],
              approvalDeadlineDays: r.approval_deadline_days as number | undefined,
              auditTrail: r.audit_trail as ChangeOrder['auditTrail'], revision: Number(r.revision) || 1,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as ChangeOrder[];
            await saveLocal(CHANGE_ORDERS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<ChangeOrder[]>(CHANGE_ORDERS_KEY, []);
    },
  });

  const invoicesQuery = useQuery({
    queryKey: ['invoices', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, number: Number(r.number), projectId: r.project_id as string,
              type: r.type as Invoice['type'], progressPercent: r.progress_percent as number | undefined,
              issueDate: r.issue_date as string, dueDate: r.due_date as string,
              paymentTerms: r.payment_terms as Invoice['paymentTerms'], notes: (r.notes as string) ?? '',
              lineItems: r.line_items as Invoice['lineItems'], subtotal: Number(r.subtotal),
              taxRate: Number(r.tax_rate), taxAmount: Number(r.tax_amount), totalDue: Number(r.total_due),
              amountPaid: Number(r.amount_paid), status: r.status as Invoice['status'],
              payments: r.payments as Invoice['payments'], createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Invoice[];
            await saveLocal(INVOICES_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Invoice[]>(INVOICES_KEY, []);
    },
  });

  const dailyReportsQuery = useQuery({
    queryKey: ['dailyReports', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('daily_reports').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, date: r.date as string,
              weather: r.weather as DailyFieldReport['weather'], manpower: r.manpower as DailyFieldReport['manpower'],
              workPerformed: (r.work_performed as string) ?? '', materialsDelivered: (r.materials_delivered as string[]) ?? [],
              issuesAndDelays: (r.issues_and_delays as string) ?? '', photos: (r.photos as DailyFieldReport['photos']) ?? [],
              status: (r.status as DailyFieldReport['status']) ?? 'draft',
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as DailyFieldReport[];
            await saveLocal(DAILY_REPORTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<DailyFieldReport[]>(DAILY_REPORTS_KEY, []);
    },
  });

  const subsQuery = useQuery({
    queryKey: ['subcontractors', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('subcontractors').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, companyName: (r.company_name as string) ?? '', contactName: (r.contact_name as string) ?? '',
              phone: (r.phone as string) ?? '', email: (r.email as string) ?? '', address: (r.address as string) ?? '',
              trade: (r.trade as Subcontractor['trade']) ?? 'General', licenseNumber: (r.license_number as string) ?? '',
              licenseExpiry: (r.license_expiry as string) ?? '', coiExpiry: (r.coi_expiry as string) ?? '',
              w9OnFile: (r.w9_on_file as boolean) ?? false, bidHistory: (r.bid_history as Subcontractor['bidHistory']) ?? [],
              assignedProjects: (r.assigned_projects as string[]) ?? [], notes: (r.notes as string) ?? '',
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Subcontractor[];
            await saveLocal(SUBS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Subcontractor[]>(SUBS_KEY, []);
    },
  });

  const punchItemsQuery = useQuery({
    queryKey: ['punchItems', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('punch_items').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, description: r.description as string,
              location: (r.location as string) ?? '', assignedSub: (r.assigned_sub as string) ?? '',
              assignedSubId: r.assigned_sub_id as string | undefined, dueDate: r.due_date as string,
              priority: (r.priority as PunchItem['priority']) ?? 'medium', status: (r.status as PunchItem['status']) ?? 'open',
              photoUri: r.photo_uri as string | undefined, rejectionNote: r.rejection_note as string | undefined,
              closedAt: r.closed_at as string | undefined, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as PunchItem[];
            await saveLocal(PUNCH_ITEMS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<PunchItem[]>(PUNCH_ITEMS_KEY, []);
    },
  });

  const photosQuery = useQuery({
    queryKey: ['projectPhotos', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('photos').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, uri: r.uri as string,
              timestamp: r.timestamp as string, location: r.location as string | undefined,
              tag: r.tag as string | undefined, linkedTaskId: r.linked_task_id as string | undefined,
              linkedTaskName: r.linked_task_name as string | undefined,
              markup: (r.markup as ProjectPhoto['markup']) ?? [], createdAt: r.created_at as string,
            })) as ProjectPhoto[];
            await saveLocal(PHOTOS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<ProjectPhoto[]>(PHOTOS_KEY, []);
    },
  });

  const priceAlertsQuery = useQuery({
    queryKey: ['priceAlerts', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('price_alerts').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, materialId: r.material_id as string, materialName: r.material_name as string,
              targetPrice: Number(r.target_price), direction: (r.direction as PriceAlert['direction']) ?? 'below',
              currentPrice: Number(r.current_price), isTriggered: (r.is_triggered as boolean) ?? false,
              isPaused: (r.is_paused as boolean) ?? false, createdAt: r.created_at as string,
            })) as PriceAlert[];
            await saveLocal(PRICE_ALERTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<PriceAlert[]>(PRICE_ALERTS_KEY, []);
    },
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('contacts').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, firstName: r.first_name as string, lastName: (r.last_name as string) ?? '',
              companyName: (r.company_name as string) ?? '', role: (r.role as Contact['role']) ?? 'Other',
              email: (r.email as string) ?? '', secondaryEmail: r.secondary_email as string | undefined,
              phone: (r.phone as string) ?? '', address: (r.address as string) ?? '', notes: (r.notes as string) ?? '',
              linkedProjectIds: (r.linked_project_ids as string[]) ?? [],
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Contact[];
            await saveLocal(CONTACTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Contact[]>(CONTACTS_KEY, []);
    },
  });

  const commEventsQuery = useQuery({
    queryKey: ['commEvents', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('comm_events').select('*').order('timestamp', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, type: r.type as CommunicationEvent['type'],
              summary: (r.summary as string) ?? '', actor: (r.actor as string) ?? '',
              recipient: r.recipient as string | undefined, detail: r.detail as string | undefined,
              isPrivate: (r.is_private as boolean) ?? false, timestamp: r.timestamp as string,
            })) as CommunicationEvent[];
            await saveLocal(COMM_EVENTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<CommunicationEvent[]>(COMM_EVENTS_KEY, []);
    },
  });

  const rfisQuery = useQuery({
    queryKey: ['rfis', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('rfis').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, number: Number(r.number),
              subject: r.subject as string, question: (r.question as string) ?? '',
              submittedBy: (r.submitted_by as string) ?? '', assignedTo: (r.assigned_to as string) ?? '',
              dateSubmitted: r.date_submitted as string, dateRequired: r.date_required as string,
              dateResponded: r.date_responded as string | undefined, response: r.response as string | undefined,
              status: (r.status as RFI['status']) ?? 'open', priority: (r.priority as RFI['priority']) ?? 'normal',
              linkedDrawing: r.linked_drawing as string | undefined, linkedTaskId: r.linked_task_id as string | undefined,
              attachments: (r.attachments as string[]) ?? [], createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as RFI[];
            await saveLocal(RFIS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<RFI[]>(RFIS_KEY, []);
    },
  });

  const submittalsQuery = useQuery({
    queryKey: ['submittals', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('submittals').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, number: Number(r.number),
              title: r.title as string, specSection: (r.spec_section as string) ?? '',
              submittedBy: (r.submitted_by as string) ?? '', submittedDate: r.submitted_date as string,
              requiredDate: r.required_date as string, reviewCycles: (r.review_cycles as Submittal['reviewCycles']) ?? [],
              currentStatus: (r.current_status as Submittal['currentStatus']) ?? 'pending',
              attachments: (r.attachments as string[]) ?? [], createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Submittal[];
            await saveLocal(SUBMITTALS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Submittal[]>(SUBMITTALS_KEY, []);
    },
  });

  const equipmentQuery = useQuery({
    queryKey: ['equipment', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('equipment').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, name: r.name as string, type: (r.type as Equipment['type']) ?? 'owned',
              category: (r.category as Equipment['category']) ?? 'other', make: (r.make as string) ?? '',
              model: (r.model as string) ?? '', year: r.year as number | undefined,
              serialNumber: r.serial_number as string | undefined, dailyRate: Number(r.daily_rate) || 0,
              currentProjectId: r.current_project_id as string | undefined,
              maintenanceSchedule: (r.maintenance_schedule as Equipment['maintenanceSchedule']) ?? [],
              utilizationLog: (r.utilization_log as Equipment['utilizationLog']) ?? [],
              status: (r.status as Equipment['status']) ?? 'available', notes: r.notes as string | undefined,
              createdAt: r.created_at as string,
            })) as Equipment[];
            await saveLocal(EQUIPMENT_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Equipment[]>(EQUIPMENT_KEY, []);
    },
  });

  const onboardingQuery = useQuery({
    queryKey: ['onboarding', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data } = await supabase.from('profiles').select('onboarding_complete').eq('id', userId).single();
          if (data?.onboarding_complete) {
            await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
            return true;
          }
        } catch { /* fallback */ }
      }
      const stored = await AsyncStorage.getItem(ONBOARDING_KEY);
      return stored === 'true';
    },
  });

  useEffect(() => { if (onboardingQuery.data !== undefined) setHasSeenOnboarding(onboardingQuery.data); }, [onboardingQuery.data]);

  const completeOnboarding = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setHasSeenOnboarding(true);
    queryClient.setQueryData(['onboarding', userId], true);
    if (canSync) {
      try { await supabase.from('profiles').update({ onboarding_complete: true }).eq('id', userId); } catch { /* ok */ }
    }
  }, [queryClient, userId, canSync]);

  useEffect(() => { if (projectsQuery.data) setProjects(projectsQuery.data); }, [projectsQuery.data]);
  useEffect(() => { if (settingsQuery.data) setSettings(settingsQuery.data); }, [settingsQuery.data]);
  useEffect(() => { if (changeOrdersQuery.data) setChangeOrders(changeOrdersQuery.data); }, [changeOrdersQuery.data]);
  useEffect(() => { if (invoicesQuery.data) setInvoices(invoicesQuery.data); }, [invoicesQuery.data]);
  useEffect(() => { if (dailyReportsQuery.data) setDailyReports(dailyReportsQuery.data); }, [dailyReportsQuery.data]);
  useEffect(() => { if (subsQuery.data) setSubcontractors(subsQuery.data); }, [subsQuery.data]);
  useEffect(() => { if (punchItemsQuery.data) setPunchItems(punchItemsQuery.data); }, [punchItemsQuery.data]);
  useEffect(() => { if (photosQuery.data) setProjectPhotos(photosQuery.data); }, [photosQuery.data]);
  useEffect(() => { if (priceAlertsQuery.data) setPriceAlerts(priceAlertsQuery.data); }, [priceAlertsQuery.data]);
  useEffect(() => { if (contactsQuery.data) setContacts(contactsQuery.data); }, [contactsQuery.data]);
  useEffect(() => { if (commEventsQuery.data) setCommEvents(commEventsQuery.data); }, [commEventsQuery.data]);
  useEffect(() => { if (rfisQuery.data) setRfis(rfisQuery.data); }, [rfisQuery.data]);
  useEffect(() => { if (submittalsQuery.data) setSubmittals(submittalsQuery.data); }, [submittalsQuery.data]);
  useEffect(() => { if (equipmentQuery.data) setEquipment(equipmentQuery.data); }, [equipmentQuery.data]);

  const syncProjectToSupabase = useCallback((project: Project, action: 'upsert' | 'delete') => {
    if (!canSync) return;
    const existing = syncDebounceMap.current.get(project.id);
    if (existing) clearTimeout(existing);
    syncDebounceMap.current.set(project.id, setTimeout(async () => {
      syncDebounceMap.current.delete(project.id);
      if (action === 'delete') {
        await supabaseWrite('projects', 'delete', { id: project.id });
      } else {
        await supabaseWrite('projects', 'insert', {
          id: project.id, user_id: userId, name: project.name, type: project.type,
          location: project.location, square_footage: project.squareFootage, quality: project.quality,
          description: project.description, estimate: project.estimate as unknown, schedule: project.schedule as unknown,
          linked_estimate: project.linkedEstimate as unknown, status: project.status,
          collaborators: project.collaborators as unknown, client_portal: project.clientPortal as unknown,
          closed_at: project.closedAt, photo_count: project.photoCount,
          created_at: project.createdAt, updated_at: project.updatedAt,
        });
      }
      console.log('[ProjectContext] Synced project to Supabase:', project.name);
    }, 800));
  }, [canSync, userId]);

  const saveProjectsMutation = useMutation({
    mutationFn: async (updatedProjects: Project[]) => { await saveLocal(PROJECTS_KEY, updatedProjects); return updatedProjects; },
    onSuccess: (data) => { queryClient.setQueryData(['projects', userId], data); },
  });
  const saveChangeOrdersMutation = useMutation({
    mutationFn: async (updated: ChangeOrder[]) => { await saveLocal(CHANGE_ORDERS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['changeOrders', userId], data); },
  });
  const saveInvoicesMutation = useMutation({
    mutationFn: async (updated: Invoice[]) => { await saveLocal(INVOICES_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['invoices', userId], data); },
  });
  const saveDailyReportsMutation = useMutation({
    mutationFn: async (updated: DailyFieldReport[]) => { await saveLocal(DAILY_REPORTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['dailyReports', userId], data); },
  });
  const saveSubsMutation = useMutation({
    mutationFn: async (updated: Subcontractor[]) => { await saveLocal(SUBS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['subcontractors', userId], data); },
  });
  const savePunchItemsMutation = useMutation({
    mutationFn: async (updated: PunchItem[]) => { await saveLocal(PUNCH_ITEMS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['punchItems', userId], data); },
  });
  const savePhotosMutation = useMutation({
    mutationFn: async (updated: ProjectPhoto[]) => { await saveLocal(PHOTOS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['projectPhotos', userId], data); },
  });
  const savePriceAlertsMutation = useMutation({
    mutationFn: async (updated: PriceAlert[]) => { await saveLocal(PRICE_ALERTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['priceAlerts', userId], data); },
  });
  const saveContactsMutation = useMutation({
    mutationFn: async (updated: Contact[]) => { await saveLocal(CONTACTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['contacts', userId], data); },
  });
  const saveCommEventsMutation = useMutation({
    mutationFn: async (updated: CommunicationEvent[]) => { await saveLocal(COMM_EVENTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['commEvents', userId], data); },
  });
  const saveRfisMutation = useMutation({
    mutationFn: async (updated: RFI[]) => { await saveLocal(RFIS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['rfis', userId], data); },
  });
  const saveSubmittalsMutation = useMutation({
    mutationFn: async (updated: Submittal[]) => { await saveLocal(SUBMITTALS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['submittals', userId], data); },
  });
  const saveEquipmentMutation = useMutation({
    mutationFn: async (updated: Equipment[]) => { await saveLocal(EQUIPMENT_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['equipment', userId], data); },
  });
  const saveSettingsMutation = useMutation({
    mutationFn: async (updatedSettings: AppSettings) => {
      await saveLocal(SETTINGS_KEY, updatedSettings);
      if (canSync) {
        try {
          await supabase.from('profiles').update({
            location: updatedSettings.location, units: updatedSettings.units,
            tax_rate: updatedSettings.taxRate, contingency_rate: updatedSettings.contingencyRate,
            company_name: updatedSettings.branding.companyName, contact_name: updatedSettings.branding.contactName,
            email: updatedSettings.branding.email, phone: updatedSettings.branding.phone,
            address: updatedSettings.branding.address, license_number: updatedSettings.branding.licenseNumber,
            tagline: updatedSettings.branding.tagline, logo_uri: updatedSettings.branding.logoUri,
            signature_data: updatedSettings.branding.signatureData, theme_colors: updatedSettings.themeColors,
            biometrics_enabled: updatedSettings.biometricsEnabled, dfr_recipients: updatedSettings.dfrRecipients,
          }).eq('id', userId);
        } catch (err) { console.log('[ProjectContext] Settings sync failed:', err); }
      }
      return updatedSettings;
    },
    onSuccess: (data) => { queryClient.setQueryData(['settings', userId], data); },
  });

  const addProject = useCallback((project: Project) => {
    const updated = [project, ...projects];
    setProjects(updated);
    saveProjectsMutation.mutate(updated);
    syncProjectToSupabase(project, 'upsert');
  }, [projects, saveProjectsMutation, syncProjectToSupabase]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    const updated = projects.map(p => p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p);
    setProjects(updated);
    saveProjectsMutation.mutate(updated);
    const proj = updated.find(p => p.id === id);
    if (proj) syncProjectToSupabase(proj, 'upsert');
  }, [projects, saveProjectsMutation, syncProjectToSupabase]);

  const deleteProject = useCallback((id: string) => {
    const toDelete = projects.find(p => p.id === id);
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    saveProjectsMutation.mutate(updated);
    if (toDelete) syncProjectToSupabase(toDelete, 'delete');
  }, [projects, saveProjectsMutation, syncProjectToSupabase]);

  const getProject = useCallback((id: string) => projects.find(p => p.id === id) ?? null, [projects]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    const updated = { ...settings, ...updates };
    setSettings(updated);
    saveSettingsMutation.mutate(updated);
  }, [settings, saveSettingsMutation]);

  const addCollaborator = useCallback((projectId: string, collab: ProjectCollaborator) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const existing = project.collaborators ?? [];
    if (existing.some(c => c.email === collab.email)) return;
    updateProject(projectId, { collaborators: [...existing, collab] });
  }, [projects, updateProject]);

  const removeCollaborator = useCallback((projectId: string, collabId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    updateProject(projectId, { collaborators: (project.collaborators ?? []).filter(c => c.id !== collabId) });
  }, [projects, updateProject]);

  const addChangeOrder = useCallback((co: ChangeOrder) => {
    const updated = [co, ...changeOrders];
    setChangeOrders(updated);
    saveChangeOrdersMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('change_orders', 'insert', {
        id: co.id, user_id: userId, project_id: co.projectId, number: co.number, date: co.date,
        description: co.description, reason: co.reason, line_items: co.lineItems, original_contract_value: co.originalContractValue,
        change_amount: co.changeAmount, new_contract_total: co.newContractTotal, status: co.status,
        approvers: co.approvers, approval_mode: co.approvalMode, approval_deadline_days: co.approvalDeadlineDays,
        audit_trail: co.auditTrail, revision: co.revision, created_at: co.createdAt, updated_at: co.updatedAt,
      });
    }
  }, [changeOrders, saveChangeOrdersMutation, canSync, userId]);

  const updateChangeOrder = useCallback((id: string, updates: Partial<ChangeOrder>) => {
    const now = new Date().toISOString();
    const prior = changeOrders.find(c => c.id === id);
    const updated = changeOrders.map(co => co.id === id ? { ...co, ...updates, updatedAt: now } : co);
    setChangeOrders(updated);
    saveChangeOrdersMutation.mutate(updated);

    // Cascade: when a CO transitions to 'approved', push its schedule impact
    // onto the linked project's schedule exactly once. The `scheduleImpactApplied`
    // flag guards against double-applying if the CO gets toggled approved→draft→approved.
    const nextCO = updated.find(c => c.id === id);
    const transitionedToApproved =
      !!nextCO &&
      nextCO.status === 'approved' &&
      prior?.status !== 'approved' &&
      !nextCO.scheduleImpactApplied &&
      (nextCO.scheduleImpactDays ?? 0) > 0;

    if (transitionedToApproved && nextCO) {
      // 1. Bump the project schedule's totalDurationDays + criticalPathDays.
      const project = projects.find(p => p.id === nextCO.projectId);
      if (project?.schedule) {
        const bumpDays = nextCO.scheduleImpactDays ?? 0;
        const newSchedule = {
          ...project.schedule,
          totalDurationDays: project.schedule.totalDurationDays + bumpDays,
          criticalPathDays: project.schedule.criticalPathDays + bumpDays,
          updatedAt: now,
        };
        const nextProjects = projects.map(p => p.id === nextCO.projectId ? { ...p, schedule: newSchedule, updatedAt: now } : p);
        setProjects(nextProjects);
        saveProjectsMutation.mutate(nextProjects);
        const proj = nextProjects.find(p => p.id === nextCO.projectId);
        if (proj) syncProjectToSupabase(proj, 'upsert');
        console.log('[CO cascade] Extended project', nextCO.projectId, 'schedule by', bumpDays, 'days');
      }

      // 2. Mark the CO's schedule impact as applied so we never double-apply.
      const finalCOs = updated.map(co => co.id === id ? { ...co, scheduleImpactApplied: true } : co);
      setChangeOrders(finalCOs);
      saveChangeOrdersMutation.mutate(finalCOs);
    }

    if (canSync) {
      const co = (transitionedToApproved ? { ...nextCO!, scheduleImpactApplied: true } : nextCO);
      if (co) {
        void supabaseWrite('change_orders', 'update', {
          id, description: co.description, reason: co.reason, line_items: co.lineItems,
          original_contract_value: co.originalContractValue, change_amount: co.changeAmount,
          new_contract_total: co.newContractTotal, status: co.status, approvers: co.approvers,
          audit_trail: co.auditTrail, revision: co.revision, updated_at: now,
          schedule_impact_days: co.scheduleImpactDays, schedule_impact_applied: co.scheduleImpactApplied,
        });
      }
    }
  }, [changeOrders, projects, saveChangeOrdersMutation, saveProjectsMutation, syncProjectToSupabase, canSync]);

  const getChangeOrdersForProject = useCallback((projectId: string) => {
    return changeOrders.filter(co => co.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [changeOrders]);

  const addInvoice = useCallback((invoice: Invoice) => {
    const updated = [invoice, ...invoices];
    setInvoices(updated);
    saveInvoicesMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('invoices', 'insert', {
        id: invoice.id, user_id: userId, project_id: invoice.projectId, number: invoice.number,
        type: invoice.type, progress_percent: invoice.progressPercent, issue_date: invoice.issueDate,
        due_date: invoice.dueDate, payment_terms: invoice.paymentTerms, notes: invoice.notes,
        line_items: invoice.lineItems, subtotal: invoice.subtotal, tax_rate: invoice.taxRate,
        tax_amount: invoice.taxAmount, total_due: invoice.totalDue, amount_paid: invoice.amountPaid,
        status: invoice.status, payments: invoice.payments, created_at: invoice.createdAt, updated_at: invoice.updatedAt,
      });
    }
  }, [invoices, saveInvoicesMutation, canSync, userId]);

  const updateInvoice = useCallback((id: string, updates: Partial<Invoice>) => {
    const now = new Date().toISOString();
    const updated = invoices.map(inv => inv.id === id ? { ...inv, ...updates, updatedAt: now } : inv);
    setInvoices(updated);
    saveInvoicesMutation.mutate(updated);
    if (canSync) {
      const inv = updated.find(i => i.id === id);
      if (inv) {
        void supabaseWrite('invoices', 'update', {
          id, notes: inv.notes, line_items: inv.lineItems, subtotal: inv.subtotal, tax_rate: inv.taxRate,
          tax_amount: inv.taxAmount, total_due: inv.totalDue, amount_paid: inv.amountPaid,
          status: inv.status, payments: inv.payments, updated_at: now,
        });
      }
    }
  }, [invoices, saveInvoicesMutation, canSync]);

  const getInvoicesForProject = useCallback((projectId: string) => invoices.filter(inv => inv.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [invoices]);
  const getTotalOutstandingBalance = useCallback(() => invoices.filter(inv => inv.status !== 'paid' && inv.status !== 'draft').reduce((sum, inv) => sum + (inv.totalDue - inv.amountPaid), 0), [invoices]);

  const addDailyReport = useCallback((report: DailyFieldReport) => {
    const updated = [report, ...dailyReports];
    setDailyReports(updated);
    saveDailyReportsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('daily_reports', 'insert', {
        id: report.id, user_id: userId, project_id: report.projectId, date: report.date,
        weather: report.weather, manpower: report.manpower, work_performed: report.workPerformed,
        materials_delivered: report.materialsDelivered, issues_and_delays: report.issuesAndDelays,
        photos: report.photos, status: report.status, created_at: report.createdAt, updated_at: report.updatedAt,
      });
    }
  }, [dailyReports, saveDailyReportsMutation, canSync, userId]);

  const updateDailyReport = useCallback((id: string, updates: Partial<DailyFieldReport>) => {
    const now = new Date().toISOString();
    const updated = dailyReports.map(dr => dr.id === id ? { ...dr, ...updates, updatedAt: now } : dr);
    setDailyReports(updated);
    saveDailyReportsMutation.mutate(updated);
    if (canSync) {
      const dr = updated.find(d => d.id === id);
      if (dr) {
        void supabaseWrite('daily_reports', 'update', {
          id, weather: dr.weather, manpower: dr.manpower, work_performed: dr.workPerformed,
          materials_delivered: dr.materialsDelivered, issues_and_delays: dr.issuesAndDelays,
          photos: dr.photos, status: dr.status, updated_at: now,
        });
      }
    }
  }, [dailyReports, saveDailyReportsMutation, canSync]);

  const getDailyReportsForProject = useCallback((projectId: string) => dailyReports.filter(dr => dr.projectId === projectId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [dailyReports]);

  const addSubcontractor = useCallback((sub: Subcontractor) => {
    const updated = [sub, ...subcontractors];
    setSubcontractors(updated);
    saveSubsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('subcontractors', 'insert', {
        id: sub.id, user_id: userId, company_name: sub.companyName, contact_name: sub.contactName,
        phone: sub.phone, email: sub.email, address: sub.address, trade: sub.trade,
        license_number: sub.licenseNumber, license_expiry: sub.licenseExpiry, coi_expiry: sub.coiExpiry,
        w9_on_file: sub.w9OnFile, bid_history: sub.bidHistory, assigned_projects: sub.assignedProjects,
        notes: sub.notes, created_at: sub.createdAt, updated_at: sub.updatedAt,
      });
    }
  }, [subcontractors, saveSubsMutation, canSync, userId]);

  const updateSubcontractor = useCallback((id: string, updates: Partial<Subcontractor>) => {
    const now = new Date().toISOString();
    const updated = subcontractors.map(s => s.id === id ? { ...s, ...updates, updatedAt: now } : s);
    setSubcontractors(updated);
    saveSubsMutation.mutate(updated);
    if (canSync) {
      const s = updated.find(x => x.id === id);
      if (s) {
        void supabaseWrite('subcontractors', 'update', {
          id, company_name: s.companyName, contact_name: s.contactName, phone: s.phone, email: s.email,
          address: s.address, trade: s.trade, license_number: s.licenseNumber, license_expiry: s.licenseExpiry,
          coi_expiry: s.coiExpiry, w9_on_file: s.w9OnFile, bid_history: s.bidHistory,
          assigned_projects: s.assignedProjects, notes: s.notes, updated_at: now,
        });
      }
    }
  }, [subcontractors, saveSubsMutation, canSync]);

  const deleteSubcontractor = useCallback((id: string) => {
    const updated = subcontractors.filter(s => s.id !== id);
    setSubcontractors(updated);
    saveSubsMutation.mutate(updated);
    if (canSync) void supabaseWrite('subcontractors', 'delete', { id });
  }, [subcontractors, saveSubsMutation, canSync]);

  const getSubcontractor = useCallback((id: string) => subcontractors.find(s => s.id === id) ?? null, [subcontractors]);

  const addPunchItem = useCallback((item: PunchItem) => {
    const updated = [item, ...punchItems];
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('punch_items', 'insert', {
        id: item.id, user_id: userId, project_id: item.projectId, description: item.description,
        location: item.location, assigned_sub: item.assignedSub, assigned_sub_id: item.assignedSubId,
        due_date: item.dueDate, priority: item.priority, status: item.status, photo_uri: item.photoUri,
        rejection_note: item.rejectionNote, closed_at: item.closedAt,
        created_at: item.createdAt, updated_at: item.updatedAt,
      });
    }
  }, [punchItems, savePunchItemsMutation, canSync, userId]);

  const updatePunchItem = useCallback((id: string, updates: Partial<PunchItem>) => {
    const now = new Date().toISOString();
    const updated = punchItems.map(pi => pi.id === id ? { ...pi, ...updates, updatedAt: now } : pi);
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) {
      const pi = updated.find(x => x.id === id);
      if (pi) {
        void supabaseWrite('punch_items', 'update', {
          id, description: pi.description, location: pi.location, assigned_sub: pi.assignedSub,
          due_date: pi.dueDate, priority: pi.priority, status: pi.status, photo_uri: pi.photoUri,
          rejection_note: pi.rejectionNote, closed_at: pi.closedAt, updated_at: now,
        });
      }
    }
  }, [punchItems, savePunchItemsMutation, canSync]);

  const deletePunchItem = useCallback((id: string) => {
    const updated = punchItems.filter(pi => pi.id !== id);
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) void supabaseWrite('punch_items', 'delete', { id });
  }, [punchItems, savePunchItemsMutation, canSync]);

  const getPunchItemsForProject = useCallback((projectId: string) => punchItems.filter(pi => pi.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [punchItems]);

  const addProjectPhoto = useCallback((photo: ProjectPhoto) => {
    const updated = [photo, ...projectPhotos];
    setProjectPhotos(updated);
    savePhotosMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('photos', 'insert', {
        id: photo.id, user_id: userId, project_id: photo.projectId, uri: photo.uri,
        timestamp: photo.timestamp, location: photo.location, tag: photo.tag,
        linked_task_id: photo.linkedTaskId, linked_task_name: photo.linkedTaskName,
        markup: photo.markup, created_at: photo.createdAt,
      });
    }
  }, [projectPhotos, savePhotosMutation, canSync, userId]);

  const deleteProjectPhoto = useCallback((id: string) => {
    const updated = projectPhotos.filter(p => p.id !== id);
    setProjectPhotos(updated);
    savePhotosMutation.mutate(updated);
    if (canSync) void supabaseWrite('photos', 'delete', { id });
  }, [projectPhotos, savePhotosMutation, canSync]);

  const getPhotosForProject = useCallback((projectId: string) => projectPhotos.filter(p => p.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [projectPhotos]);

  const addPriceAlert = useCallback((alert: PriceAlert) => {
    const updated = [alert, ...priceAlerts];
    setPriceAlerts(updated);
    savePriceAlertsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('price_alerts', 'insert', {
        id: alert.id, user_id: userId, material_id: alert.materialId, material_name: alert.materialName,
        target_price: alert.targetPrice, direction: alert.direction, current_price: alert.currentPrice,
        is_triggered: alert.isTriggered, is_paused: alert.isPaused, created_at: alert.createdAt,
      });
    }
  }, [priceAlerts, savePriceAlertsMutation, canSync, userId]);

  const updatePriceAlert = useCallback((id: string, updates: Partial<PriceAlert>) => {
    const updated = priceAlerts.map(a => a.id === id ? { ...a, ...updates } : a);
    setPriceAlerts(updated);
    savePriceAlertsMutation.mutate(updated);
    if (canSync) {
      const a = updated.find(x => x.id === id);
      if (a) {
        void supabaseWrite('price_alerts', 'update', {
          id, target_price: a.targetPrice, direction: a.direction, current_price: a.currentPrice,
          is_triggered: a.isTriggered, is_paused: a.isPaused,
        });
      }
    }
  }, [priceAlerts, savePriceAlertsMutation, canSync]);

  const deletePriceAlert = useCallback((id: string) => {
    const updated = priceAlerts.filter(a => a.id !== id);
    setPriceAlerts(updated);
    savePriceAlertsMutation.mutate(updated);
    if (canSync) void supabaseWrite('price_alerts', 'delete', { id });
  }, [priceAlerts, savePriceAlertsMutation, canSync]);

  const addContact = useCallback((contact: Contact) => {
    const updated = [contact, ...contacts];
    setContacts(updated);
    saveContactsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('contacts', 'insert', {
        id: contact.id, user_id: userId, first_name: contact.firstName, last_name: contact.lastName,
        company_name: contact.companyName, role: contact.role, email: contact.email,
        secondary_email: contact.secondaryEmail, phone: contact.phone, address: contact.address,
        notes: contact.notes, linked_project_ids: contact.linkedProjectIds,
        created_at: contact.createdAt, updated_at: contact.updatedAt,
      });
    }
  }, [contacts, saveContactsMutation, canSync, userId]);

  const updateContact = useCallback((id: string, updates: Partial<Contact>) => {
    const now = new Date().toISOString();
    const updated = contacts.map(c => c.id === id ? { ...c, ...updates, updatedAt: now } : c);
    setContacts(updated);
    saveContactsMutation.mutate(updated);
    if (canSync) {
      const c = updated.find(x => x.id === id);
      if (c) {
        void supabaseWrite('contacts', 'update', {
          id, first_name: c.firstName, last_name: c.lastName, company_name: c.companyName,
          role: c.role, email: c.email, secondary_email: c.secondaryEmail, phone: c.phone,
          address: c.address, notes: c.notes, linked_project_ids: c.linkedProjectIds, updated_at: now,
        });
      }
    }
  }, [contacts, saveContactsMutation, canSync]);

  const deleteContact = useCallback((id: string) => {
    const updated = contacts.filter(c => c.id !== id);
    setContacts(updated);
    saveContactsMutation.mutate(updated);
    if (canSync) void supabaseWrite('contacts', 'delete', { id });
  }, [contacts, saveContactsMutation, canSync]);

  const getContact = useCallback((id: string) => contacts.find(c => c.id === id) ?? null, [contacts]);

  const addCommEvent = useCallback((event: CommunicationEvent) => {
    const updated = [event, ...commEvents];
    setCommEvents(updated);
    saveCommEventsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('comm_events', 'insert', {
        id: event.id, user_id: userId, project_id: event.projectId, type: event.type,
        summary: event.summary, actor: event.actor, recipient: event.recipient,
        detail: event.detail, is_private: event.isPrivate, timestamp: event.timestamp,
      });
    }
  }, [commEvents, saveCommEventsMutation, canSync, userId]);

  const getCommEventsForProject = useCallback((projectId: string) => commEvents.filter(e => e.projectId === projectId).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [commEvents]);

  const addRFI = useCallback((rfi: Omit<RFI, 'id' | 'createdAt' | 'updatedAt' | 'number'>) => {
    const projectRfis = rfis.filter(r => r.projectId === rfi.projectId);
    const nextNumber = projectRfis.length > 0 ? Math.max(...projectRfis.map(r => r.number)) + 1 : 1;
    const now = new Date().toISOString();
    const newRfi: RFI = { ...rfi, id: generateUUID(), number: nextNumber, createdAt: now, updatedAt: now };
    const updated = [newRfi, ...rfis];
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('rfis', 'insert', {
        id: newRfi.id, user_id: userId, project_id: newRfi.projectId, number: newRfi.number,
        subject: newRfi.subject, question: newRfi.question, submitted_by: newRfi.submittedBy,
        assigned_to: newRfi.assignedTo, date_submitted: newRfi.dateSubmitted, date_required: newRfi.dateRequired,
        status: newRfi.status, priority: newRfi.priority, linked_drawing: newRfi.linkedDrawing,
        linked_task_id: newRfi.linkedTaskId, attachments: newRfi.attachments,
        created_at: now, updated_at: now,
      });
    }
  }, [rfis, saveRfisMutation, canSync, userId]);

  const updateRFI = useCallback((id: string, updates: Partial<RFI>) => {
    const now = new Date().toISOString();
    const updated = rfis.map(r => r.id === id ? { ...r, ...updates, updatedAt: now } : r);
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) {
      const r = updated.find(x => x.id === id);
      if (r) {
        void supabaseWrite('rfis', 'update', {
          id, subject: r.subject, question: r.question, assigned_to: r.assignedTo,
          date_responded: r.dateResponded, response: r.response, status: r.status,
          priority: r.priority, attachments: r.attachments, updated_at: now,
        });
      }
    }
  }, [rfis, saveRfisMutation, canSync]);

  const deleteRFI = useCallback((id: string) => {
    const updated = rfis.filter(r => r.id !== id);
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) void supabaseWrite('rfis', 'delete', { id });
  }, [rfis, saveRfisMutation, canSync]);

  const getRFIsForProject = useCallback((projectId: string) => rfis.filter(r => r.projectId === projectId).sort((a, b) => b.number - a.number), [rfis]);

  const addSubmittal = useCallback((sub: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>) => {
    const projectSubs = submittals.filter(s => s.projectId === sub.projectId);
    const nextNumber = projectSubs.length > 0 ? Math.max(...projectSubs.map(s => s.number)) + 1 : 1;
    const now = new Date().toISOString();
    const newSub: Submittal = { ...sub, id: generateUUID(), number: nextNumber, createdAt: now, updatedAt: now };
    const updated = [newSub, ...submittals];
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('submittals', 'insert', {
        id: newSub.id, user_id: userId, project_id: newSub.projectId, number: newSub.number,
        title: newSub.title, spec_section: newSub.specSection, submitted_by: newSub.submittedBy,
        submitted_date: newSub.submittedDate, required_date: newSub.requiredDate,
        review_cycles: newSub.reviewCycles, current_status: newSub.currentStatus,
        attachments: newSub.attachments, created_at: now, updated_at: now,
      });
    }
  }, [submittals, saveSubmittalsMutation, canSync, userId]);

  const updateSubmittal = useCallback((id: string, updates: Partial<Submittal>) => {
    const now = new Date().toISOString();
    const updated = submittals.map(s => s.id === id ? { ...s, ...updates, updatedAt: now } : s);
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) {
      const s = updated.find(x => x.id === id);
      if (s) {
        void supabaseWrite('submittals', 'update', {
          id, title: s.title, spec_section: s.specSection, review_cycles: s.reviewCycles,
          current_status: s.currentStatus, attachments: s.attachments, updated_at: now,
        });
      }
    }
  }, [submittals, saveSubmittalsMutation, canSync]);

  const deleteSubmittal = useCallback((id: string) => {
    const updated = submittals.filter(s => s.id !== id);
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) void supabaseWrite('submittals', 'delete', { id });
  }, [submittals, saveSubmittalsMutation, canSync]);

  const getSubmittalsForProject = useCallback((projectId: string) => submittals.filter(s => s.projectId === projectId).sort((a, b) => b.number - a.number), [submittals]);

  const addReviewCycle = useCallback((submittalId: string, cycle: Omit<SubmittalReviewCycle, 'cycleNumber'>) => {
    const sub = submittals.find(s => s.id === submittalId);
    if (!sub) return;
    const nextCycle = sub.reviewCycles.length + 1;
    const newCycle: SubmittalReviewCycle = { ...cycle, cycleNumber: nextCycle };
    updateSubmittal(submittalId, { reviewCycles: [...sub.reviewCycles, newCycle], currentStatus: cycle.status });
  }, [submittals, updateSubmittal]);

  const addEquipment = useCallback((equip: Omit<Equipment, 'id' | 'createdAt'>) => {
    const now = new Date().toISOString();
    const newEquip: Equipment = { ...equip, id: generateUUID(), createdAt: now };
    const updated = [newEquip, ...equipment];
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('equipment', 'insert', {
        id: newEquip.id, user_id: userId, name: newEquip.name, type: newEquip.type,
        category: newEquip.category, make: newEquip.make, model: newEquip.model, year: newEquip.year,
        serial_number: newEquip.serialNumber, daily_rate: newEquip.dailyRate,
        current_project_id: newEquip.currentProjectId, maintenance_schedule: newEquip.maintenanceSchedule,
        utilization_log: newEquip.utilizationLog, status: newEquip.status, notes: newEquip.notes, created_at: now,
      });
    }
  }, [equipment, saveEquipmentMutation, canSync, userId]);

  const updateEquipment = useCallback((id: string, updates: Partial<Equipment>) => {
    const updated = equipment.map(e => e.id === id ? { ...e, ...updates } : e);
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) {
      const e = updated.find(x => x.id === id);
      if (e) {
        void supabaseWrite('equipment', 'update', {
          id, name: e.name, type: e.type, category: e.category, make: e.make, model: e.model,
          daily_rate: e.dailyRate, current_project_id: e.currentProjectId,
          maintenance_schedule: e.maintenanceSchedule, utilization_log: e.utilizationLog,
          status: e.status, notes: e.notes,
        });
      }
    }
  }, [equipment, saveEquipmentMutation, canSync]);

  const deleteEquipment = useCallback((id: string) => {
    const updated = equipment.filter(e => e.id !== id);
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) void supabaseWrite('equipment', 'delete', { id });
  }, [equipment, saveEquipmentMutation, canSync]);

  const logUtilization = useCallback((entry: Omit<EquipmentUtilizationEntry, 'id'>) => {
    const newEntry: EquipmentUtilizationEntry = { ...entry, id: generateUUID() };
    const updated = equipment.map(e => e.id === entry.equipmentId ? { ...e, utilizationLog: [...e.utilizationLog, newEntry] } : e);
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) {
      const e = updated.find(x => x.id === entry.equipmentId);
      if (e) {
        void supabaseWrite('equipment', 'update', { id: e.id, utilization_log: e.utilizationLog });
      }
    }
  }, [equipment, saveEquipmentMutation, canSync]);

  const getEquipmentForProject = useCallback((projectId: string) => equipment.filter(e => e.currentProjectId === projectId), [equipment]);

  const getEquipmentCostForProject = useCallback((projectId: string) => {
    return equipment
      .filter(e => e.currentProjectId === projectId)
      .reduce((sum, e) => {
        const daysUsed = e.utilizationLog.filter(u => u.projectId === projectId).length;
        return sum + (e.dailyRate * Math.max(daysUsed, 1));
      }, 0);
  }, [equipment]);

  // Warranties — local-only storage for now
  useEffect(() => {
    void loadLocal<Warranty[]>(WARRANTIES_KEY, []).then(setWarranties);
  }, []);

  const persistWarranties = useCallback((list: Warranty[]) => {
    setWarranties(list);
    void saveLocal(WARRANTIES_KEY, list);
  }, []);

  const computeWarrantyStatus = useCallback((w: Warranty): Warranty['status'] => {
    if (w.status === 'claimed' || w.status === 'void') return w.status;
    const end = new Date(w.endDate).getTime();
    const now = Date.now();
    if (end < now) return 'expired';
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysLeft = Math.ceil((end - now) / msPerDay);
    const threshold = w.reminderDays ?? 30;
    if (daysLeft <= threshold) return 'expiring_soon';
    return 'active';
  }, []);

  const addWarranty = useCallback((w: Omit<Warranty, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'claims'> & { id?: string; status?: Warranty['status']; claims?: WarrantyClaim[] }) => {
    const now = new Date().toISOString();
    const fresh: Warranty = {
      id: w.id ?? `warr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now, updatedAt: now,
      status: w.status ?? 'active',
      claims: w.claims ?? [],
      ...w,
    } as Warranty;
    fresh.status = computeWarrantyStatus(fresh);
    persistWarranties([fresh, ...warranties]);
    return fresh;
  }, [warranties, persistWarranties, computeWarrantyStatus]);

  const updateWarranty = useCallback((id: string, updates: Partial<Warranty>) => {
    const now = new Date().toISOString();
    const next = warranties.map(w => {
      if (w.id !== id) return w;
      const merged = { ...w, ...updates, updatedAt: now };
      merged.status = computeWarrantyStatus(merged);
      return merged;
    });
    persistWarranties(next);
  }, [warranties, persistWarranties, computeWarrantyStatus]);

  const deleteWarranty = useCallback((id: string) => {
    persistWarranties(warranties.filter(w => w.id !== id));
  }, [warranties, persistWarranties]);

  const getWarrantiesForProject = useCallback((projectId: string) =>
    warranties.filter(w => w.projectId === projectId).sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()),
    [warranties]);

  const addWarrantyClaim = useCallback((warrantyId: string, claim: Omit<WarrantyClaim, 'id'>) => {
    const id = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newClaim: WarrantyClaim = { id, ...claim };
    const next = warranties.map(w => w.id === warrantyId ? { ...w, claims: [newClaim, ...(w.claims ?? [])], updatedAt: new Date().toISOString() } : w);
    persistWarranties(next);
  }, [warranties, persistWarranties]);

  // Portal messages — client ↔ GC Q&A thread, local-only storage.
  const [portalMessages, setPortalMessages] = useState<PortalMessage[]>([]);

  useEffect(() => {
    void loadLocal<PortalMessage[]>(PORTAL_MESSAGES_KEY, []).then(setPortalMessages);
  }, []);

  const persistPortalMessages = useCallback((list: PortalMessage[]) => {
    setPortalMessages(list);
    void saveLocal(PORTAL_MESSAGES_KEY, list);
  }, []);

  const addPortalMessage = useCallback((msg: Omit<PortalMessage, 'id' | 'createdAt'>) => {
    const fresh: PortalMessage = {
      ...msg,
      id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    persistPortalMessages([...portalMessages, fresh]);
    return fresh;
  }, [portalMessages, persistPortalMessages]);

  const markPortalMessagesRead = useCallback((projectId: string, side: 'gc' | 'client') => {
    const next = portalMessages.map(m => {
      if (m.projectId !== projectId) return m;
      if (side === 'gc' && m.authorType === 'client' && !m.readByGc) return { ...m, readByGc: true };
      if (side === 'client' && m.authorType === 'gc' && !m.readByClient) return { ...m, readByClient: true };
      return m;
    });
    persistPortalMessages(next);
  }, [portalMessages, persistPortalMessages]);

  const getPortalMessagesForProject = useCallback((projectId: string) =>
    portalMessages
      .filter(m => m.projectId === projectId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [portalMessages]);

  const getUnreadPortalMessageCount = useCallback((projectId: string, side: 'gc' | 'client') =>
    portalMessages.filter(m =>
      m.projectId === projectId &&
      (side === 'gc' ? m.authorType === 'client' && !m.readByGc : m.authorType === 'gc' && !m.readByClient)
    ).length,
    [portalMessages]);

  const getTotalUnreadPortalCountForGc = useCallback(() =>
    portalMessages.filter(m => m.authorType === 'client' && !m.readByGc).length,
    [portalMessages]);

  const sortedProjects = useMemo(() => [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [projects]);

  return useMemo(() => ({
    projects: sortedProjects, settings, hasSeenOnboarding, completeOnboarding,
    isLoading: projectsQuery.isLoading || settingsQuery.isLoading || onboardingQuery.isLoading,
    addProject, updateProject, deleteProject, getProject, updateSettings,
    addCollaborator, removeCollaborator,
    changeOrders, addChangeOrder, updateChangeOrder, getChangeOrdersForProject,
    addInvoice, updateInvoice, getInvoicesForProject, getTotalOutstandingBalance, invoices,
    addDailyReport, updateDailyReport, getDailyReportsForProject,
    subcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor, getSubcontractor,
    punchItems, addPunchItem, updatePunchItem, deletePunchItem, getPunchItemsForProject,
    projectPhotos, addProjectPhoto, deleteProjectPhoto, getPhotosForProject,
    priceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert,
    contacts, addContact, updateContact, deleteContact, getContact,
    commEvents, addCommEvent, getCommEventsForProject,
    rfis, addRFI, updateRFI, deleteRFI, getRFIsForProject,
    submittals, addSubmittal, updateSubmittal, deleteSubmittal, getSubmittalsForProject, addReviewCycle,
    equipment, addEquipment, updateEquipment, deleteEquipment, logUtilization, getEquipmentForProject, getEquipmentCostForProject,
    warranties, addWarranty, updateWarranty, deleteWarranty, getWarrantiesForProject, addWarrantyClaim,
    portalMessages, addPortalMessage, markPortalMessagesRead, getPortalMessagesForProject, getUnreadPortalMessageCount, getTotalUnreadPortalCountForGc,
  }), [sortedProjects, settings, hasSeenOnboarding, completeOnboarding, projectsQuery.isLoading, settingsQuery.isLoading, onboardingQuery.isLoading, addProject, updateProject, deleteProject, getProject, updateSettings, addCollaborator, removeCollaborator, changeOrders, addChangeOrder, updateChangeOrder, getChangeOrdersForProject, addInvoice, updateInvoice, getInvoicesForProject, getTotalOutstandingBalance, invoices, addDailyReport, updateDailyReport, getDailyReportsForProject, subcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor, getSubcontractor, punchItems, addPunchItem, updatePunchItem, deletePunchItem, getPunchItemsForProject, projectPhotos, addProjectPhoto, deleteProjectPhoto, getPhotosForProject, priceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert, contacts, addContact, updateContact, deleteContact, getContact, commEvents, addCommEvent, getCommEventsForProject, rfis, addRFI, updateRFI, deleteRFI, getRFIsForProject, submittals, addSubmittal, updateSubmittal, deleteSubmittal, getSubmittalsForProject, addReviewCycle, equipment, addEquipment, updateEquipment, deleteEquipment, logUtilization, getEquipmentForProject, getEquipmentCostForProject, warranties, addWarranty, updateWarranty, deleteWarranty, getWarrantiesForProject, addWarrantyClaim, portalMessages, addPortalMessage, markPortalMessagesRead, getPortalMessagesForProject, getUnreadPortalMessageCount, getTotalUnreadPortalCountForGc]);
});

```


---

### `contexts/BidsContext.tsx`

```tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { PublicBid, CertificationType, BidType, BidCategory } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';

const BIDS_KEY = 'mageid_public_bids';

export const [BidsProvider, useBids] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canSync = !!userId && isSupabaseConfigured;
  const [bids, setBids] = useState<PublicBid[]>([]);

  const bidsQuery = useQuery({
    queryKey: ['public_bids'],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('public_bids')
            .select('*')
            .order('fetched_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, title: r.title as string,
              issuingAgency: (r.issuing_agency as string) ?? '', city: (r.city as string) ?? '',
              state: (r.state as string) ?? '', category: (r.category as BidCategory) ?? 'construction',
              bidType: (r.bid_type as BidType) ?? 'state', estimatedValue: Number(r.estimated_value) || 0,
              bondRequired: Number(r.bond_required) || 0, deadline: r.deadline as string,
              description: (r.description as string) ?? '', postedBy: (r.posted_by as string) ?? '',
              postedDate: r.posted_date as string, status: (r.status as PublicBid['status']) ?? 'open',
              requiredCertifications: (r.required_certifications as CertificationType[]) ?? [],
              contactEmail: (r.contact_email as string) ?? '', applyUrl: r.apply_url as string | undefined,
              sourceUrl: r.source_url as string | undefined, sourceName: r.source_name as string | undefined,
            })) as PublicBid[];
            await AsyncStorage.setItem(BIDS_KEY, JSON.stringify(mapped));
            return mapped;
          }
          if (error) console.log('[BidsContext] Supabase query error:', error.message);
        } catch (err) {
          console.log('[BidsContext] Supabase fetch failed (network):', err);
        }
      }
      const stored = await AsyncStorage.getItem(BIDS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PublicBid[];
        if (parsed.length > 0) return parsed;
      }
      return [];
    },
  });

  useEffect(() => { if (bidsQuery.data) setBids(bidsQuery.data); }, [bidsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (updated: PublicBid[]) => { await AsyncStorage.setItem(BIDS_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['public_bids'], data); },
  });

  const addBid = useCallback((bid: PublicBid) => {
    const updated = [bid, ...bids];
    setBids(updated);
    saveMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('public_bids', 'insert', {
        id: bid.id, user_id: userId, title: bid.title, issuing_agency: bid.issuingAgency,
        city: bid.city, state: bid.state, category: bid.category, bid_type: bid.bidType,
        estimated_value: bid.estimatedValue, bond_required: bid.bondRequired, deadline: bid.deadline,
        description: bid.description, posted_by: bid.postedBy, posted_date: bid.postedDate,
        status: bid.status, required_certifications: bid.requiredCertifications,
        contact_email: bid.contactEmail, apply_url: bid.applyUrl,
        source_url: bid.sourceUrl, source_name: bid.sourceName,
      });
    }
  }, [bids, saveMutation, canSync, userId]);

  const updateBid = useCallback((id: string, changes: Partial<PublicBid>) => {
    const updated = bids.map(b => b.id === id ? { ...b, ...changes } : b);
    setBids(updated);
    saveMutation.mutate(updated);
  }, [bids, saveMutation]);

  const deleteBid = useCallback((id: string) => {
    const updated = bids.filter(b => b.id !== id);
    setBids(updated);
    saveMutation.mutate(updated);
    if (canSync) void supabaseWrite('public_bids', 'delete', { id });
  }, [bids, saveMutation, canSync]);

  return useMemo(() => ({
    bids, addBid, updateBid, deleteBid, isLoading: bidsQuery.isLoading,
  }), [bids, addBid, updateBid, deleteBid, bidsQuery.isLoading]);
});

export function useFilteredBids(filters: {
  search?: string; state?: string; category?: BidCategory; bidType?: BidType; certification?: CertificationType;
}) {
  const { bids } = useBids();
  return useMemo(() => {
    let filtered = [...bids];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(b => b.title.toLowerCase().includes(q) || b.city.toLowerCase().includes(q) || b.issuingAgency.toLowerCase().includes(q));
    }
    if (filters.state) filtered = filtered.filter(b => b.state === filters.state);
    if (filters.category) filtered = filtered.filter(b => b.category === filters.category);
    if (filters.bidType) filtered = filtered.filter(b => b.bidType === filters.bidType);
    if (filters.certification) filtered = filtered.filter(b => b.requiredCertifications.includes(filters.certification!));
    return filtered;
  }, [bids, filters.search, filters.state, filters.category, filters.bidType, filters.certification]);
}

```


---

### `contexts/CompaniesContext.tsx`

```tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { CompanyProfile, CertificationType, BidCategory } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';

const COMPANIES_KEY = 'mageid_companies';

export const [CompaniesProvider, useCompanies] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canSync = !!userId && isSupabaseConfigured;
  const [companies, setCompanies] = useState<CompanyProfile[]>([]);

  const companiesQuery = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('companies')
            .select('*')
            .order('fetched_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, companyName: (r.company_name as string) ?? '',
              city: (r.city as string) ?? '', state: (r.state as string) ?? '',
              primaryCategory: (r.primary_category as BidCategory) ?? 'construction',
              bondCapacity: Number(r.bond_capacity) || 0, completedProjects: Number(r.completed_projects) || 0,
              rating: Number(r.rating) || 0, contactEmail: (r.contact_email as string) ?? '',
              phone: (r.phone as string) ?? '', description: (r.description as string) ?? '',
              certifications: (r.certifications as CertificationType[]) ?? [],
              website: r.website as string | undefined, yearEstablished: r.year_established as number | undefined,
              employeeCount: r.employee_count as number | undefined, createdAt: r.created_at as string,
            })) as CompanyProfile[];
            await AsyncStorage.setItem(COMPANIES_KEY, JSON.stringify(mapped));
            return mapped;
          }
        } catch (err) {
          console.log('[CompaniesContext] Supabase fetch failed:', err);
        }
      }
      const stored = await AsyncStorage.getItem(COMPANIES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CompanyProfile[];
        if (parsed.length > 0) return parsed;
      }
      return [];
    },
  });

  useEffect(() => { if (companiesQuery.data) setCompanies(companiesQuery.data); }, [companiesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (updated: CompanyProfile[]) => { await AsyncStorage.setItem(COMPANIES_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['companies'], data); },
  });

  const addCompany = useCallback((company: CompanyProfile) => {
    const updated = [company, ...companies];
    setCompanies(updated);
    saveMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('companies', 'insert', {
        id: company.id, user_id: userId, company_name: company.companyName,
        city: company.city, state: company.state, primary_category: company.primaryCategory,
        bond_capacity: company.bondCapacity, completed_projects: company.completedProjects,
        rating: company.rating, contact_email: company.contactEmail, phone: company.phone,
        description: company.description, certifications: company.certifications,
        website: company.website, year_established: company.yearEstablished, employee_count: company.employeeCount,
      });
    }
  }, [companies, saveMutation, canSync, userId]);

  const updateCompany = useCallback((id: string, changes: Partial<CompanyProfile>) => {
    const updated = companies.map(c => c.id === id ? { ...c, ...changes } : c);
    setCompanies(updated);
    saveMutation.mutate(updated);
  }, [companies, saveMutation]);

  return useMemo(() => ({
    companies, addCompany, updateCompany, isLoading: companiesQuery.isLoading,
  }), [companies, addCompany, updateCompany, companiesQuery.isLoading]);
});

export function useFilteredCompanies(filters: {
  search?: string; state?: string; certification?: CertificationType; category?: BidCategory; minBondCapacity?: number;
}) {
  const { companies } = useCompanies();
  return useMemo(() => {
    let filtered = [...companies];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(c => c.companyName.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
    }
    if (filters.state) filtered = filtered.filter(c => c.state === filters.state);
    if (filters.certification) filtered = filtered.filter(c => c.certifications.includes(filters.certification!));
    if (filters.category) filtered = filtered.filter(c => c.primaryCategory === filters.category);
    if (filters.minBondCapacity) filtered = filtered.filter(c => c.bondCapacity >= filters.minBondCapacity!);
    return filtered;
  }, [companies, filters.search, filters.state, filters.certification, filters.category, filters.minBondCapacity]);
}

```


---

### `contexts/HireContext.tsx`

```tsx
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { JobListing, WorkerProfile, Conversation, ChatMessage, TradeCategory, JobType, ExperienceLevel } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { sendLocalNotification } from '@/utils/notifications';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { generateUUID } from '@/utils/generateId';

const JOBS_KEY = 'mageid_jobs';
const WORKERS_KEY = 'mageid_workers';
const CONVERSATIONS_KEY = 'mageid_conversations';
const MESSAGES_KEY = 'mageid_messages';

export const [HireProvider, useHire] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canSync = !!userId && isSupabaseConfigured;

  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [workers, setWorkers] = useState<WorkerProfile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('job_listings')
            .select('*')
            .order('fetched_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, companyId: (r.company_id as string) ?? '',
              companyName: (r.company_name as string) ?? '', title: r.title as string,
              tradeCategory: r.trade_category as TradeCategory, city: (r.city as string) ?? '',
              state: (r.state as string) ?? '', payMin: Number(r.pay_min) || 0,
              payMax: Number(r.pay_max) || 0, payType: (r.pay_type as 'hourly' | 'salary') ?? 'hourly',
              jobType: (r.job_type as JobType) ?? 'full_time',
              requiredLicenses: (r.required_licenses as string[]) ?? [],
              experienceLevel: (r.experience_level as ExperienceLevel) ?? 'mid',
              description: (r.description as string) ?? '', startDate: (r.start_date as string) ?? '',
              postedDate: r.posted_date as string, status: (r.status as JobListing['status']) ?? 'open',
              applicantCount: Number(r.applicant_count) || 0,
            })) as JobListing[];
            await AsyncStorage.setItem(JOBS_KEY, JSON.stringify(mapped));
            return mapped;
          }
        } catch (err) {
          console.log('[HireContext] Supabase jobs fetch failed:', err);
        }
      }
      const stored = await AsyncStorage.getItem(JOBS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as JobListing[];
        if (parsed.length > 0) return parsed;
      }
      return [];
    },
  });

  const workersQuery = useQuery({
    queryKey: ['workers'],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('worker_profiles')
            .select('*')
            .order('fetched_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, name: r.name as string,
              tradeCategory: r.trade_category as TradeCategory,
              yearsExperience: Number(r.years_experience) || 0,
              licenses: (r.licenses as string[]) ?? [], city: (r.city as string) ?? '',
              state: (r.state as string) ?? '',
              availability: (r.availability as WorkerProfile['availability']) ?? 'available',
              hourlyRate: Number(r.hourly_rate) || 0, bio: (r.bio as string) ?? '',
              pastProjects: (r.past_projects as string[]) ?? [],
              contactEmail: (r.contact_email as string) ?? '', phone: (r.phone as string) ?? '',
              createdAt: r.created_at as string,
            })) as WorkerProfile[];
            await AsyncStorage.setItem(WORKERS_KEY, JSON.stringify(mapped));
            return mapped;
          }
        } catch (err) {
          console.log('[HireContext] Supabase workers fetch failed:', err);
        }
      }
      const stored = await AsyncStorage.getItem(WORKERS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as WorkerProfile[];
        if (parsed.length > 0) return parsed;
      }
      return [];
    },
  });

  const convoQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('conversations')
            .select('*')
            .order('last_message_time', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              participantIds: (r.participant_ids as string[]) ?? [],
              participantNames: (r.participant_names as string[]) ?? [],
              lastMessage: (r.last_message as string) ?? '',
              lastMessageTime: r.last_message_time as string,
              unreadCount: 0,
            })) as Conversation[];
            await AsyncStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(mapped));
            return mapped;
          }
        } catch { /* fallback */ }
      }
      const stored = await AsyncStorage.getItem(CONVERSATIONS_KEY);
      return stored ? JSON.parse(stored) as Conversation[] : [];
    },
  });

  const messagesQuery = useQuery({
    queryKey: ['messages'],
    queryFn: async () => {
      if (canSync) {
        try {
          const convoIds = conversations.map(c => c.id).filter(Boolean);
          if (convoIds.length > 0) {
            const { data, error } = await supabase
              .from('messages')
              .select('*')
              .in('conversation_id', convoIds)
              .order('timestamp', { ascending: true });
            if (!error && data) {
              const mapped = data.map((r: Record<string, unknown>) => ({
                id: r.id as string,
                conversationId: r.conversation_id as string,
                senderId: r.sender_id as string,
                senderName: (r.sender_name as string) ?? '',
                text: (r.text as string) ?? '',
                timestamp: r.timestamp as string,
              })) as ChatMessage[];
              await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(mapped));
              return mapped;
            }
          }
        } catch (err) {
          console.log('[HireContext] Supabase messages fetch failed:', err);
        }
      }
      const stored = await AsyncStorage.getItem(MESSAGES_KEY);
      return stored ? JSON.parse(stored) as ChatMessage[] : [];
    },
  });

  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => { if (jobsQuery.data) setJobs(jobsQuery.data); }, [jobsQuery.data]);
  useEffect(() => { if (workersQuery.data) setWorkers(workersQuery.data); }, [workersQuery.data]);
  useEffect(() => { if (convoQuery.data) setConversations(convoQuery.data); }, [convoQuery.data]);
  useEffect(() => { if (messagesQuery.data) setMessages(messagesQuery.data); }, [messagesQuery.data]);

  const convoIdsKey = useMemo(() => conversations.map(c => c.id).join(','), [conversations]);

  useEffect(() => {
    if (!canSync) return;

    const convoIds = convoIdsKey.split(',').filter(Boolean);
    if (convoIds.length === 0) {
      console.log('[HireContext] No conversations, skipping Realtime subscription');
      return;
    }

    console.log('[HireContext] Setting up filtered Realtime for', convoIds.length, 'conversations');

    if (realtimeChannelRef.current) {
      void supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    const channel = supabase
      .channel(`realtime-messages-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=in.(${convoIds.join(',')})`,
        },
        (payload) => {
          console.log('[Realtime] New message received:', payload.new);
          const r = payload.new as Record<string, unknown>;
          const newMsg: ChatMessage = {
            id: r.id as string,
            conversationId: r.conversation_id as string,
            senderId: r.sender_id as string,
            senderName: (r.sender_name as string) ?? '',
            text: (r.text as string) ?? '',
            timestamp: r.timestamp as string,
          };

          if (newMsg.senderId !== userId) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });

            void sendLocalNotification(
              `New message from ${newMsg.senderName}`,
              newMsg.text,
              { conversationId: newMsg.conversationId },
            );
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload) => {
          console.log('[Realtime] Conversation updated:', payload.eventType);
          if (payload.eventType === 'UPDATE') {
            const r = payload.new as Record<string, unknown>;
            setConversations(prev =>
              prev.map(c =>
                c.id === (r.id as string)
                  ? {
                      ...c,
                      lastMessage: (r.last_message as string) ?? c.lastMessage,
                      lastMessageTime: (r.last_message_time as string) ?? c.lastMessageTime,
                    }
                  : c,
              ),
            );
          } else if (payload.eventType === 'INSERT') {
            const r = payload.new as Record<string, unknown>;
            const participantIds = (r.participant_ids as string[]) ?? [];
            if (participantIds.includes(userId!)) {
              const newConvo: Conversation = {
                id: r.id as string,
                participantIds,
                participantNames: (r.participant_names as string[]) ?? [],
                lastMessage: (r.last_message as string) ?? '',
                lastMessageTime: (r.last_message_time as string) ?? new Date().toISOString(),
                unreadCount: 1,
              };
              setConversations(prev => {
                if (prev.some(c => c.id === newConvo.id)) return prev;
                return [newConvo, ...prev];
              });
            }
          }
        },
      )
      .subscribe((status) => {
        console.log('[Realtime] Subscription status:', status);
      });

    realtimeChannelRef.current = channel;

    return () => {
      console.log('[HireContext] Cleaning up Realtime subscription');
      if (realtimeChannelRef.current) {
        void supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [canSync, userId, convoIdsKey]);

  const saveJobsMutation = useMutation({
    mutationFn: async (updated: JobListing[]) => { await AsyncStorage.setItem(JOBS_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => queryClient.setQueryData(['jobs'], data),
  });
  const saveWorkersMutation = useMutation({
    mutationFn: async (updated: WorkerProfile[]) => { await AsyncStorage.setItem(WORKERS_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => queryClient.setQueryData(['workers'], data),
  });
  const saveConvosMutation = useMutation({
    mutationFn: async (updated: Conversation[]) => { await AsyncStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => queryClient.setQueryData(['conversations'], data),
  });
  const saveMessagesMutation = useMutation({
    mutationFn: async (updated: ChatMessage[]) => { await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => queryClient.setQueryData(['messages'], data),
  });

  const addJob = useCallback((job: JobListing) => {
    const updated = [job, ...jobs];
    setJobs(updated);
    saveJobsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('job_listings', 'insert', {
        id: job.id, user_id: userId, company_id: job.companyId, company_name: job.companyName,
        title: job.title, trade_category: job.tradeCategory, city: job.city, state: job.state,
        pay_min: job.payMin, pay_max: job.payMax, pay_type: job.payType, job_type: job.jobType,
        required_licenses: job.requiredLicenses, experience_level: job.experienceLevel,
        description: job.description, start_date: job.startDate, posted_date: job.postedDate,
        status: job.status, applicant_count: job.applicantCount,
      });
    }
  }, [jobs, saveJobsMutation, canSync, userId]);

  const updateJob = useCallback((id: string, changes: Partial<JobListing>) => {
    const updated = jobs.map(j => j.id === id ? { ...j, ...changes } : j);
    setJobs(updated);
    saveJobsMutation.mutate(updated);
    if (canSync) {
      const j = updated.find(x => x.id === id);
      if (j) {
        void supabaseWrite('job_listings', 'update', {
          id, title: j.title, trade_category: j.tradeCategory, city: j.city, state: j.state,
          pay_min: j.payMin, pay_max: j.payMax, pay_type: j.payType, job_type: j.jobType,
          required_licenses: j.requiredLicenses, experience_level: j.experienceLevel,
          description: j.description, start_date: j.startDate, status: j.status,
          applicant_count: j.applicantCount,
        });
      }
    }
  }, [jobs, saveJobsMutation, canSync]);

  const addWorker = useCallback((worker: WorkerProfile) => {
    const updated = [worker, ...workers];
    setWorkers(updated);
    saveWorkersMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('worker_profiles', 'insert', {
        id: worker.id, user_id: userId, name: worker.name, trade_category: worker.tradeCategory,
        years_experience: worker.yearsExperience, licenses: worker.licenses, city: worker.city,
        state: worker.state, availability: worker.availability, hourly_rate: worker.hourlyRate,
        bio: worker.bio, past_projects: worker.pastProjects, contact_email: worker.contactEmail, phone: worker.phone,
      });
    }
  }, [workers, saveWorkersMutation, canSync, userId]);

  const applyToJob = useCallback((jobId: string) => {
    const updated = jobs.map(j => j.id === jobId ? { ...j, applicantCount: j.applicantCount + 1 } : j);
    setJobs(updated);
    saveJobsMutation.mutate(updated);
  }, [jobs, saveJobsMutation]);

  const sendMessage = useCallback((conversationId: string, senderId: string, senderName: string, text: string) => {
    const msg: ChatMessage = {
      id: generateUUID(),
      conversationId, senderId, senderName, text,
      timestamp: new Date().toISOString(),
    };
    const updatedMessages = [...messages, msg];
    setMessages(updatedMessages);
    saveMessagesMutation.mutate(updatedMessages);

    const updatedConvos = conversations.map(c =>
      c.id === conversationId
        ? { ...c, lastMessage: text, lastMessageTime: msg.timestamp, unreadCount: c.unreadCount + 1 }
        : c
    );
    setConversations(updatedConvos);
    saveConvosMutation.mutate(updatedConvos);

    if (canSync) {
      void supabaseWrite('messages', 'insert', {
        conversation_id: conversationId, sender_id: senderId, sender_name: senderName, text,
      });
      void supabase.from('conversations').update({
        last_message: text, last_message_time: new Date().toISOString(),
      }).eq('id', conversationId);
    }
  }, [messages, conversations, saveMessagesMutation, saveConvosMutation, canSync]);

  const startConversation = useCallback((participantIds: string[], participantNames: string[], initialMessage: string) => {
    const existingConvo = conversations.find(c =>
      c.participantIds.length === participantIds.length &&
      participantIds.every(id => c.participantIds.includes(id))
    );
    if (existingConvo) return existingConvo.id;

    const convoId = generateUUID();
    const newConvo: Conversation = {
      id: convoId, participantIds, participantNames,
      lastMessage: initialMessage, lastMessageTime: new Date().toISOString(), unreadCount: 0,
    };
    const updatedConvos = [newConvo, ...conversations];
    setConversations(updatedConvos);
    saveConvosMutation.mutate(updatedConvos);

    if (canSync) {
      void (async () => {
        try {
          const { error: convoError } = await supabase.from('conversations').insert({
            id: convoId, participant_ids: participantIds, participant_names: participantNames, last_message: initialMessage,
          });
          if (convoError) {
            console.log('[HireContext] Failed to insert conversation:', convoError.message);
            return;
          }
          const { error: partError } = await supabase
            .from('conversation_participants')
            .insert(participantIds.map(pid => ({ conversation_id: convoId, user_id: pid })));
          if (partError) {
            console.log('[HireContext] Failed to insert participants:', partError.message);
          }
        } catch (err) {
          console.log('[HireContext] startConversation sync failed:', err);
        }
      })();
    }

    if (initialMessage) {
      sendMessage(convoId, participantIds[0], participantNames[0], initialMessage);
    }
    return convoId;
  }, [conversations, saveConvosMutation, sendMessage, canSync]);

  const getConversationMessages = useCallback((conversationId: string) => {
    return messages.filter(m => m.conversationId === conversationId);
  }, [messages]);

  return useMemo(() => ({
    jobs, workers, conversations,
    addJob, updateJob, addWorker, applyToJob,
    sendMessage, startConversation, getConversationMessages,
    isLoading: jobsQuery.isLoading || workersQuery.isLoading,
  }), [jobs, workers, conversations, addJob, updateJob, addWorker, applyToJob, sendMessage, startConversation, getConversationMessages, jobsQuery.isLoading, workersQuery.isLoading]);
});

export function useFilteredJobs(filters: {
  search?: string; trade?: TradeCategory; state?: string; jobType?: JobType; experienceLevel?: ExperienceLevel;
}) {
  const { jobs } = useHire();
  return useMemo(() => {
    let filtered = [...jobs];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(j => j.title.toLowerCase().includes(q) || j.companyName.toLowerCase().includes(q) || j.city.toLowerCase().includes(q));
    }
    if (filters.trade) filtered = filtered.filter(j => j.tradeCategory === filters.trade);
    if (filters.state) filtered = filtered.filter(j => j.state === filters.state);
    if (filters.jobType) filtered = filtered.filter(j => j.jobType === filters.jobType);
    if (filters.experienceLevel) filtered = filtered.filter(j => j.experienceLevel === filters.experienceLevel);
    return filtered;
  }, [jobs, filters.search, filters.trade, filters.state, filters.jobType, filters.experienceLevel]);
}

export function useFilteredWorkers(filters: {
  search?: string; trade?: TradeCategory; state?: string; availability?: string;
}) {
  const { workers } = useHire();
  return useMemo(() => {
    let filtered = [...workers];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(w => w.name.toLowerCase().includes(q) || w.city.toLowerCase().includes(q) || w.bio.toLowerCase().includes(q));
    }
    if (filters.trade) filtered = filtered.filter(w => w.tradeCategory === filters.trade);
    if (filters.state) filtered = filtered.filter(w => w.state === filters.state);
    if (filters.availability) filtered = filtered.filter(w => w.availability === filters.availability);
    return filtered;
  }, [workers, filters.search, filters.trade, filters.state, filters.availability]);
}

```


---

### `contexts/NotificationContext.tsx`

```tsx
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  registerForPushNotifications,
  addNotificationResponseListener,
} from '@/utils/notifications';

export const [NotificationProvider, useNotifications] = createContextHook(() => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [badgeCount, setBadgeCount] = useState(0);
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    console.log('[NotificationContext] Registering for push notifications');
    void registerForPushNotifications().then(async (token) => {
      if (token) {
        setPushToken(token);
        console.log('[NotificationContext] Push token obtained:', token);

        if (user.id) {
          try {
            await supabase
              .from('profiles')
              .update({ push_token: token })
              .eq('id', user.id);
            console.log('[NotificationContext] Push token saved to Supabase');
          } catch (err) {
            console.log('[NotificationContext] Failed to save push token:', err);
          }
        }
      }
    });

    responseListenerRef.current = addNotificationResponseListener((response) => {
      console.log('[NotificationContext] Notification tapped:', response.notification.request.content);
      const data = response.notification.request.content.data;

      const conversationId = data?.conversationId as string | undefined;
      const bidId = data?.bidId as string | undefined;
      const changeOrderId = data?.changeOrderId as string | undefined;

      if (conversationId) {
        router.push(`/messages?id=${conversationId}`);
      } else if (bidId) {
        router.push(`/bid-detail?id=${bidId}`);
      } else if (changeOrderId) {
        router.push(`/change-order?id=${changeOrderId}`);
      }
    });

    return () => {
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
        responseListenerRef.current = null;
      }
    };
  }, [isAuthenticated, user, router]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    console.log('[NotificationContext] Setting up bid response realtime listener');

    const bidChannel = supabase
      .channel('realtime-bid-notifications')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'public_bids' },
        (payload) => {
          const r = payload.new as Record<string, unknown>;
          const oldR = payload.old as Record<string, unknown>;
          if (r.status !== oldR.status) {
            console.log('[Realtime] Bid status changed:', r.id, r.status);
            void queryClient.invalidateQueries({ queryKey: ['public_bids'] });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'change_orders' },
        (payload) => {
          const r = payload.new as Record<string, unknown>;
          const oldR = payload.old as Record<string, unknown>;
          if (r.status !== oldR.status) {
            console.log('[Realtime] Change order status changed:', r.id, r.status);
            void queryClient.invalidateQueries({ queryKey: ['changeOrders'] });
          }
        },
      )
      .subscribe((status) => {
        console.log('[NotificationContext] Bid/CO realtime status:', status);
      });

    return () => {
      void supabase.removeChannel(bidChannel);
    };
  }, [isAuthenticated, user, queryClient]);

  const clearBadge = useCallback(async () => {
    setBadgeCount(0);
    if (Platform.OS !== 'web') {
      try {
        await Notifications.setBadgeCountAsync(0);
      } catch { /* ok */ }
    }
  }, []);

  const incrementBadge = useCallback(() => {
    setBadgeCount(prev => {
      const next = prev + 1;
      if (Platform.OS !== 'web') {
        void Notifications.setBadgeCountAsync(next).catch(() => {});
      }
      return next;
    });
  }, []);

  return useMemo(() => ({
    pushToken,
    badgeCount,
    clearBadge,
    incrementBadge,
  }), [pushToken, badgeCount, clearBadge, incrementBadge]);
});

```


---

### `hooks/useTierAccess.ts`

```ts
import { useCallback, useMemo } from 'react';
import { useSubscription } from '@/contexts/SubscriptionContext';
import type { SubscriptionTier } from '@/types';

/**
 * Feature keys used across the app. When gating a screen or action,
 * always reference one of these keys so the tier-gating logic is centralized.
 */
export type FeatureKey =
  // Pro+ features
  | 'unlimited_projects'
  | 'cash_flow_forecaster'
  | 'schedule_gantt_pdf'
  | 'ai_code_check'
  | 'client_portal'
  | 'lien_waiver_manager'
  | 'proposal_templates'
  | 'equipment_rental'
  | 'custom_templates'
  | 'voice_to_report'
  | 'pdf_export'
  | 'photo_documentation'
  | 'budget_health_evm'
  | 'price_alerts'
  | 'change_orders_invoicing'
  | 'daily_field_reports'
  | 'schedule_scenarios'
  // Business-only features
  | 'unlimited_bid_responses'
  | 'time_tracking'
  | 'quickbooks_sync'
  | 'plan_viewer'
  | 'subcontractor_management'
  | 'punch_list_closeout'
  | 'rfis_submittals'
  | 'full_budget_dashboard'
  // All tiers (with limits)
  | 'voice_commands'
  | 'post_homeowner_request'
  | 'post_community_bid';

/** The minimum tier required to unlock a feature. */
const REQUIRED_TIER: Record<FeatureKey, 'free' | 'pro' | 'business'> = {
  // Pro+
  unlimited_projects: 'pro',
  cash_flow_forecaster: 'pro',
  schedule_gantt_pdf: 'pro',
  ai_code_check: 'pro',
  client_portal: 'pro',
  lien_waiver_manager: 'pro',
  proposal_templates: 'pro',
  equipment_rental: 'pro',
  custom_templates: 'pro',
  voice_to_report: 'pro',
  pdf_export: 'pro',
  photo_documentation: 'pro',
  budget_health_evm: 'pro',
  price_alerts: 'pro',
  change_orders_invoicing: 'pro',
  daily_field_reports: 'pro',
  schedule_scenarios: 'pro',
  // Business-only
  unlimited_bid_responses: 'business',
  time_tracking: 'business',
  quickbooks_sync: 'business',
  plan_viewer: 'business',
  subcontractor_management: 'business',
  punch_list_closeout: 'business',
  rfis_submittals: 'business',
  full_budget_dashboard: 'business',
  // Available to all
  voice_commands: 'free',
  post_homeowner_request: 'free',
  post_community_bid: 'free',
};

/** Per-tier monthly quotas for features that have usage caps. */
export const FEATURE_LIMITS = {
  post_homeowner_request: { free: 2, pro: Infinity, business: Infinity },
  post_community_bid: { free: 2, pro: 8, business: 25 },
  ai_code_check_daily: { free: 3, pro: 20, business: Infinity },
} as const;

function tierMeetsRequirement(
  currentTier: SubscriptionTier,
  requiredTier: 'free' | 'pro' | 'business',
): boolean {
  if (requiredTier === 'free') return true;
  if (requiredTier === 'pro') return currentTier === 'pro' || currentTier === 'business';
  if (requiredTier === 'business') return currentTier === 'business';
  return false;
}

/**
 * Central access-control hook. Returns the current tier and a `canAccess`
 * helper that answers: "Can this user use <featureKey>?"
 *
 * @example
 * const { tier, canAccess, requiredTierFor } = useTierAccess();
 * if (!canAccess('cash_flow_forecaster')) { showPaywall(); return; }
 */
export function useTierAccess() {
  const { tier } = useSubscription();

  const canAccess = useCallback(
    (feature: FeatureKey): boolean => {
      const required = REQUIRED_TIER[feature];
      return tierMeetsRequirement(tier, required);
    },
    [tier],
  );

  const requiredTierFor = useCallback(
    (feature: FeatureKey): 'free' | 'pro' | 'business' => REQUIRED_TIER[feature],
    [],
  );

  const isProOrAbove = useMemo(() => tier === 'pro' || tier === 'business', [tier]);
  const isBusiness = useMemo(() => tier === 'business', [tier]);
  const isFree = useMemo(() => tier === 'free', [tier]);

  return useMemo(
    () => ({
      tier,
      isFree,
      isProOrAbove,
      isBusiness,
      canAccess,
      requiredTierFor,
    }),
    [tier, isFree, isProOrAbove, isBusiness, canAccess, requiredTierFor],
  );
}

export default useTierAccess;

```
