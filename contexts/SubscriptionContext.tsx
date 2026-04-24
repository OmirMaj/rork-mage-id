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
  // Per-platform production keys. RevenueCat requires separate App-level keys
  // for iOS, Android, and Web — they map to distinct billing integrations
  // (StoreKit, Google Play Billing, RevenueCat Web Billing / Stripe).
  //
  // In dev (__DEV__) we fall back to the shared test key so simulator builds
  // and Metro hot-reload don't burn through real entitlements. In production
  // we pick the platform-specific key and fall back to the test key only as
  // a last resort so the app still boots without a paywall if a key is
  // accidentally missing from the build env.
  if (__DEV__) {
    return process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
  }
  return Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
      ?? process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
      ?? process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY,
    web: process.env.EXPO_PUBLIC_REVENUECAT_WEB_API_KEY
      ?? process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY,
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
