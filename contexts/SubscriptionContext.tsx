import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { ensureRCWebMount } from '@/utils/rcWebMount';
import { isOwner } from '@/utils/owner';
import { track, AnalyticsEvents } from '@/utils/analytics';
import type { SubscriptionTier } from '@/types';

const SUBSCRIPTION_KEY = 'mageid_subscription_tier';

function getRCApiKey(): string | undefined {
  // Per-platform production keys. RevenueCat requires separate App-level keys
  // for iOS, Android, and Web — they map to distinct billing integrations
  // (StoreKit, Google Play Billing, RevenueCat Web Billing / Stripe).
  //
  // Each platform has its OWN key prefix:
  //   ios:     appl_xxx
  //   android: goog_xxx
  //   web:     rcb_xxx (or rcb_sb_xxx for sandbox)
  //
  // The web RC SDK throws "Invalid API key" if you hand it an appl_ or
  // goog_ key — they're not interchangeable. So when WEB has no
  // EXPO_PUBLIC_REVENUECAT_WEB_API_KEY set, we DO NOT fall back to the
  // shared test key (which is an iOS key). Returning undefined skips
  // configuration cleanly with a single console.log instead of spamming
  // dozens of validation errors.
  //
  // For iOS/Android in DEV the test fallback IS valid — it's an iOS test key
  // and RN-purchases on iOS accepts it; on Android the goog_ form is
  // missing but the simulator still boots (entitlements are absent
  // rather than mis-typed).
  //
  // IT IS NOT VALID IN A RELEASE BUILD, and it used to be reachable there.
  // Until 2026-09-11 the release branch below read
  //
  //     ios:     …IOS_API_KEY     ?? …TEST_API_KEY,
  //     android: …ANDROID_API_KEY ?? …TEST_API_KEY,
  //     default: …TEST_API_KEY,
  //
  // which made a variable whose NAME says "test" a production credential path
  // on three of the four platforms. That is worse than it sounds, because
  // scripts/validate-release-keys.ts exempted `_TEST_`-named variables from its
  // sandbox scan on the reasoning that such a variable is SUPPOSED to hold a
  // non-production value. Both statements were true at once: the guard skipped
  // the variable because of its name, and a release build could reach it. Put a
  // genuine sandbox key in the variable the guard tells you it is safe to put a
  // sandbox key in, unset the iOS key in a profile, and iOS release builds ship
  // a till that cannot charge — with every check green.
  //
  // Nothing was broken in practice (the variable happened to hold the live
  // `appl_` key, byte-identical to the iOS one). The hole was in the reasoning,
  // and this is the same class as the `rcb_sb_` miss below: a check that passes
  // because of a NAME rather than a ROLE.
  //
  // So the release branch now takes each platform's OWN key or nothing. Web
  // already worked this way for the separate reason documented above, and the
  // no-key path is a clean skip with one log — see configureRC.
  if (__DEV__) {
    if (Platform.OS === 'web') {
      // In dev on web, only use a key that's actually a web key. Skip
      // otherwise — better than the noisy crash loop on every reload.
      return process.env.EXPO_PUBLIC_REVENUECAT_WEB_API_KEY;
    }
    return process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
  }
  // RELEASE. Each platform's own key or nothing — no cross-platform and no
  // test-variable fallback. If the key isn't set, skip configuration entirely
  // (return undefined): subscription state reads from the local AsyncStorage
  // cache + the Supabase mirror, both of which already work without RC
  // initialized. A missing key is a visible, logged skip; a wrong key that
  // configures cleanly is the failure nobody sees.
  return Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
    web: process.env.EXPO_PUBLIC_REVENUECAT_WEB_API_KEY,
    default: undefined,
  });
}

/**
 * Sanity-check a key against the platform it's about to be used on.
 * Catches the case where someone sets the wrong env var (e.g. an iOS
 * key in EXPO_PUBLIC_REVENUECAT_WEB_API_KEY) and would otherwise hit
 * the same "Invalid API key" loop at runtime.
 */
function isKeyValidForPlatform(key: string): boolean {
  if (Platform.OS === 'web') return key.startsWith('rcb_');
  if (Platform.OS === 'ios') return key.startsWith('appl_');
  if (Platform.OS === 'android') return key.startsWith('goog_');
  return true;
}

/**
 * A SANDBOX key. RevenueCat's sandbox forms carry an `_sb_` infix — the web
 * billing one is `rcb_sb_…` against production's `rcb_…`.
 *
 * This needs its own check because `isKeyValidForPlatform` cannot catch it:
 * `rcb_sb_…`.startsWith('rcb_') is TRUE, so a sandbox key passes the only
 * pre-flight this file had and configures cleanly. Everything then looks
 * healthy — the SDK initialises, offerings load, the paywall renders — and the
 * one thing that does not happen is a charge.
 *
 * Found 2026-09-10: `eas.json` carried `rcb_sb_…` in the PRODUCTION profile,
 * so no web visitor could ever have been billed. An app with 0 paid conversions
 * and a sandbox key in production has not been told anything about its market.
 */
function isSandboxKey(key: string): boolean {
  return /(^|_)sb_/.test(key);
}

let rcConfigured = false;

function configureRC() {
  if (rcConfigured) return;
  const apiKey = getRCApiKey();
  if (!apiKey) {
    console.log(`[RC] No ${Platform.OS} API key configured — RevenueCat disabled. ` +
      `Subscription state will use the local cache + Supabase mirror only.`);
    return;
  }
  // Pre-flight: bail loudly if the key prefix doesn't match the platform.
  // Otherwise the SDK throws on every render and the console fills with
  // "Invalid API key" — we'd rather skip with one log than crash-loop.
  if (!isKeyValidForPlatform(apiKey)) {
    const expected = Platform.OS === 'web' ? 'rcb_'
      : Platform.OS === 'ios' ? 'appl_'
      : Platform.OS === 'android' ? 'goog_'
      : '?';
    console.warn(`[RC] API key for ${Platform.OS} should start with "${expected}" — got "${apiKey.slice(0, 6)}…". ` +
      `Skipping RC configuration to avoid crash loop.`);
    return;
  }
  // A sandbox key in a RELEASE build is not a warning, it is a broken till.
  // Deliberately still configured afterwards rather than skipped: skipping
  // would blank the paywall and hide the cause, whereas configuring lets the
  // screen render and fail at the charge, where it is diagnosable. What must
  // not happen is this passing silently, which is exactly what it did.
  if (!__DEV__ && isSandboxKey(apiKey)) {
    console.error(
      `[RC] SANDBOX KEY IN A PRODUCTION BUILD — "${apiKey.slice(0, 8)}…" on ${Platform.OS}. ` +
      'RevenueCat will initialise and offerings will load, but NO REAL PURCHASE CAN COMPLETE. ' +
      'Replace the key for this platform with its production value in eas.json (and .env for ' +
      'local runs); the web one is rcb_… with no "sb".',
    );
  }
  try {
    void Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey });
    rcConfigured = true;
    // On web, ensure the purchases-js checkout has a top-level mount target so
    // the iframe renders above the React Native Web app shell instead of being
    // clipped by the layout container.
    ensureRCWebMount();
    console.log('[RC] RevenueCat configured successfully');
  } catch (err) {
    console.log('[RC] Failed to configure RevenueCat:', err);
  }
}

configureRC();

function tierFromCustomerInfo(info: CustomerInfo): SubscriptionTier {
  // Resolve in highest-tier-first order so a user with multiple active
  // entitlements (e.g. legacy Pro lingering after Enterprise upgrade)
  // always shows the more permissive tier.
  if (info.entitlements.active['enterprise']?.isActive) return 'enterprise';
  if (info.entitlements.active['business']?.isActive) return 'business';
  if (info.entitlements.active['pro']?.isActive) return 'pro';
  return 'free';
}

// NOTE: as of migration 20260608120000 the `subscriptions.tier` column is
// server-authoritative — a DB trigger pins tier for non-service-role writers, so
// the `tier` we send here is IGNORED by the server (it can't grant or downgrade).
// Tier is granted only by the service-role revenuecat-webhook. We still upsert so
// the row's `revenuecat_customer_id` stays linked; the tier field is harmless.
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

  // Identify the RevenueCat user AS our Supabase user, so RC's app_user_id is
  // the Supabase user uuid. This is what lets the server-side revenuecat-webhook
  // map RC purchase events straight to a subscriptions row by user_id — the
  // trusted path that grants paid tiers now that clients can no longer self-grant
  // (migration 20260608120000). RevenueCat's logIn aliases any prior anonymous
  // purchases onto the identified id, so existing buyers aren't detached.
  useEffect(() => {
    if (!rcConfigured || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        await Purchases.logIn(userId);
        if (!cancelled) {
          await queryClient.invalidateQueries({ queryKey: ['rc-customer-info'] });
        }
      } catch (err) {
        console.log('[RC] logIn failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, queryClient]);

  // AUTH-F17: sign-out never called Purchases.logOut(), so RevenueCat stayed
  // identified as the previous account — its entitlements, its receipts — until
  // the next user's logIn aliased over it. Log out the moment the auth user
  // goes away (a deliberate sign-out, account deletion, or a session the server
  // rejected — RT-R1), on the platforms where RC is configured. `logOut` throws
  // for an anonymous RC user, so check first when the SDK can tell us.
  const previousUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousUserIdRef.current;
    previousUserIdRef.current = userId;
    if (!rcConfigured || !previous || userId) return;
    let cancelled = false;
    (async () => {
      try {
        if (typeof Purchases.isAnonymous === 'function' && (await Purchases.isAnonymous())) return;
        const info = await Purchases.logOut();
        if (cancelled) return;
        setTier('free');
        void AsyncStorage.setItem(SUBSCRIPTION_KEY, 'free');
        queryClient.setQueryData(['rc-customer-info'], info);
        console.log('[RC] Logged out of RevenueCat after sign-out');
      } catch (err) {
        console.log('[RC] logOut failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, queryClient]);

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

    // Master account override — emails in OWNER_EMAILS (utils/owner.ts)
    // resolve to Business tier regardless of what RevenueCat or Supabase
    // think. Lets the platform owner test/demo every paywalled feature
    // without burning real subscriptions or maintaining a sandbox account.
    // Logged loudly so it's obvious in the console when this is active.
    if (isOwner(user?.email)) {
      if (resolved !== 'business') {
        console.log('[Subscription] Master account override active — forcing tier to business');
      }
      resolved = 'business';
    }

    setTier(resolved);
    void AsyncStorage.setItem(SUBSCRIPTION_KEY, resolved);
  }, [customerInfoQuery.data, localTierQuery.data, supabaseTierQuery.data, userId, user?.email]);

  useEffect(() => {
    if (!rcConfigured) return;
    const listener = (info: CustomerInfo) => {
      console.log('[RC] Customer info updated via listener');
      let newTier = tierFromCustomerInfo(info);
      // Honor the master-account override here too — without this, an
      // RC entitlement push (e.g. trial expired) would knock the owner
      // back down to Free until the next mount.
      if (isOwner(user?.email)) newTier = 'business';
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
  }, [queryClient, userId, user?.email]);

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
      // Re-assert the web mount-point before each purchase. If a route change
      // unmounted the host element (or another script removed it) this puts
      // it back in place so the checkout iframe has somewhere to render.
      ensureRCWebMount();
      const result = await Purchases.purchasePackage(pkg);
      return result;
    },
    onSuccess: async (data) => {
      const newTier = tierFromCustomerInfo(data.customerInfo);
      console.log('[RC] Purchase successful, new tier:', newTier);
      // The conversion event. Previously only STARTED/FAILED were tracked, so
      // successful upgrades were invisible — the funnel dead-ended at intent.
      track(AnalyticsEvents.SUBSCRIPTION_PURCHASED, { tier: newTier });
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

  // Enterprise — top tier ($150/mo). Configure the matching products in
  // App Store Connect / Play Console / RevenueCat with these identifiers
  // before this resolves to a real package.
  const enterprisePackage = useMemo(() => {
    const packages = offeringsQuery.data?.current?.availablePackages ?? [];
    return packages.find((p) =>
      p.identifier === 'enterprise_monthly' ||
      p.product?.identifier === 'com.mageid.enterprise.monthly'
    ) ?? null;
  }, [offeringsQuery.data]);

  const enterpriseAnnualPackage = useMemo(() => {
    const packages = offeringsQuery.data?.current?.availablePackages ?? [];
    return packages.find((p) =>
      p.identifier === 'enterprise_annual' ||
      p.product?.identifier === 'com.mageid.enterprise.annual'
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

  const purchaseEnterprise = useCallback(async (period: 'monthly' | 'annual' = 'monthly') => {
    const pkg = period === 'annual' ? enterpriseAnnualPackage : enterprisePackage;
    if (pkg) {
      await purchaseMutation.mutateAsync(pkg);
    } else {
      throw new Error('Enterprise package not configured. Set up the product in App Store Connect / Play Console / RevenueCat first.');
    }
  }, [enterprisePackage, enterpriseAnnualPackage, purchaseMutation]);

  const restorePurchases = useCallback(async () => {
    await restoreMutation.mutateAsync();
  }, [restoreMutation]);

  // Tier helpers. `isProOrAbove` is the most common gate (paid users), so it
  // includes business + enterprise too. `isBusinessOrAbove` is for features
  // that require business tier as a minimum.
  const isProOrAbove = useMemo(() => tier === 'pro' || tier === 'business' || tier === 'enterprise', [tier]);
  const isBusinessTier = useMemo(() => tier === 'business' || tier === 'enterprise', [tier]);
  const isEnterpriseTier = useMemo(() => tier === 'enterprise', [tier]);
  const isLoading = customerInfoQuery.isLoading || offeringsQuery.isLoading || purchaseMutation.isPending;

  return useMemo(() => ({
    tier,
    isProOrAbove,
    isBusinessTier,
    isEnterpriseTier,
    isLoading,
    purchasePro,
    purchaseBusiness,
    purchaseEnterprise,
    restorePurchases,
    proPackage,
    proAnnualPackage,
    businessPackage,
    businessAnnualPackage,
    enterprisePackage,
    enterpriseAnnualPackage,
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
    tier, isProOrAbove, isBusinessTier, isEnterpriseTier, isLoading,
    purchasePro, purchaseBusiness, purchaseEnterprise, restorePurchases,
    proPackage, proAnnualPackage, businessPackage, businessAnnualPackage,
    enterprisePackage, enterpriseAnnualPackage,
    offeringsQuery.data, purchaseMutation.isPending,
  ]);
});

export function useSubscriptionGate(requiredTier: 'pro' | 'business' | 'enterprise') {
  const { tier } = useSubscription();
  const { push } = useRouter();

  const canAccess = useMemo(() => {
    // Rank-based — higher tier always satisfies a lower requirement.
    // Pre-fix this was an exact-set check that excluded enterprise from
    // every gate, mirroring the same omission bug we fixed in
    // supabase/functions/_shared/auth.ts.
    const RANK = { free: 0, pro: 1, business: 2, enterprise: 3 } as const;
    return RANK[tier] >= RANK[requiredTier];
  }, [tier, requiredTier]);

  const showPaywall = useCallback(() => {
    push('/paywall');
  }, [push]);

  return { canAccess, requiredTier, currentTier: tier, showPaywall };
}
