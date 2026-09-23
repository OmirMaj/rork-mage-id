import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'expo-router';
import { AppState, Platform } from 'react-native';
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

// --- BEGIN subscriptionResolve (pure; scripts/validate-w5-paywall-tiers.ts executes this block) ---
/**
 * Where the tier comes from, for the one screen that has to route a cancel or
 * a plan change somewhere that works (Settings → Manage Subscription, #176):
 *   'store'  — an active App Store / Google Play entitlement backs the tier,
 *              so the store's subscription page can cancel or change it;
 *   'manual' — the tier above free comes from the server row (a plan MAGE ID
 *              turned on by hand), a promotional/web entitlement, or the
 *              master-account override: no store page has anything to cancel;
 *   'none'   — free.
 */
export type PlanSource = 'store' | 'manual' | 'none';

const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };

/** The higher-ranked of the known tiers; null when none is known. */
export function maxTier(...tiers: (SubscriptionTier | null | undefined)[]): SubscriptionTier | null {
  let best: SubscriptionTier | null = null;
  for (const t of tiers) {
    if (!t || !(t in TIER_RANK)) continue;
    if (best === null || TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}

/**
 * The tier the app runs on.
 *
 * #2 (blocker): this used to be "RevenueCat wins" — when CustomerInfo loaded,
 * its entitlements decided, and a server tier that disagreed was logged as a
 * "mismatch" and ignored. But every paid plan today is turned on BY HAND (the
 * founder sets subscriptions.tier with the service key; pricing.html says so),
 * and a hand-granted customer has no RevenueCat entitlement. So on the iPhone —
 * where RevenueCat is configured — he resolved to Free and hit a paywall on
 * every paid screen while every edge function served him as Pro.
 *
 * subscriptions.tier is server-authoritative (migration 20260608120000: a
 * trigger pins it for every client write), so it is safe to trust. Neither
 * source may LOWER the other: the tier is the higher rank of the two.
 *   rcTier     — tierFromCustomerInfo, or null when RevenueCat has no answer;
 *   serverTier — subscriptions.tier (end_date honoured), null for "no row"
 *                or signed out, undefined when the server has not answered
 *                (loading/offline);
 *   localTier  — the last resolved tier, from AsyncStorage.
 * The local cache stands in for the server ONLY while the server has not
 * answered — so a hand-granted Pro opening the app offline stays Pro. A server
 * answer of "no row" is a definitive Free, never a reason to fall back to the
 * cache: on web RevenueCat has no answer at all, and the cache there may hold
 * the plan of the account that last signed out of this browser (a shared
 * office machine), or a grant the founder ended by deleting the row. The
 * master-account override is applied last, as before.
 */
export function resolveTier(o: {
  rcTier: SubscriptionTier | null;
  serverTier: SubscriptionTier | null | undefined;
  localTier: SubscriptionTier | null | undefined;
  isOwner: boolean;
}): SubscriptionTier {
  const server = o.serverTier === undefined ? (o.localTier ?? null) : (o.serverTier ?? 'free');
  let resolved: SubscriptionTier = maxTier(o.rcTier, server) ?? 'free';
  if (o.isOwner) resolved = 'business';
  return resolved;
}

/** The store an ACTIVE entitlement for `tier` was bought through, if any. */
export function storeOfActiveEntitlement(
  info: { entitlements: { active: Record<string, { isActive?: boolean; store?: string } | undefined> } } | null | undefined,
  tier: SubscriptionTier,
): string | null {
  const e = info?.entitlements?.active?.[tier];
  return e && e.isActive !== false ? (e.store ?? null) : null;
}

/** CONTRACT 1 — see PlanSource. `store` is storeOfActiveEntitlement(info, tier). */
export function planSourceFor(tier: SubscriptionTier, store: string | null | undefined): PlanSource {
  if (tier === 'free') return 'none';
  if (store === 'APP_STORE' || store === 'PLAY_STORE') return 'store';
  return 'manual';
}

/**
 * Thrown by restorePurchases() where there is no store to ask (web, or a build
 * with no RevenueCat key). #126: this path used to return the LOCAL CACHE of
 * the tier as if it were the store's answer, so Restore "succeeded" on web.
 */
export class RestoreUnavailableError extends Error {
  constructor() {
    super('Restore is done in the MAGE ID iPhone or Android app.');
    this.name = 'RestoreUnavailableError';
  }
}

const TIER_LABEL: Record<SubscriptionTier, string> = {
  free: 'Free', pro: 'Pro', business: 'Business', enterprise: 'Enterprise',
};

/**
 * What a Restore tap tells the contractor (#126). Restore used to say "Your
 * purchases have been restored" whenever the call did not throw — including
 * the common case where the store found nothing — and the first-run paywall
 * then closed itself as if he had paid. Only a tier above free is a restore.
 *   tier above free          → "Restored — you're on {Tier}", leave: true
 *   'free'                   → nothing found for this store account, stay
 *   RestoreUnavailableError  → restore is done in the phone app, stay
 *   anything else            → the store could not be reached, try again, stay
 */
export function restoreOutcome(
  result: unknown,
  storeName: 'App Store' | 'Google Play',
): { title: string; body: string; leave: boolean } {
  if (result instanceof RestoreUnavailableError
    || (result instanceof Error && result.name === 'RestoreUnavailableError')) {
    return {
      title: 'Restore is in the mobile app',
      body: 'Purchases are restored in the MAGE ID iPhone or Android app. Open it, sign in with this account, and tap Restore on the plans screen.',
      leave: false,
    };
  }
  if (typeof result === 'string' && result in TIER_RANK) {
    const t = result as SubscriptionTier;
    if (TIER_RANK[t] > 0) {
      return { title: `Restored — you're on ${TIER_LABEL[t]}`, body: 'Your plan is active on this account.', leave: true };
    }
    return {
      title: 'Nothing to restore',
      body: `No active subscription found for this ${storeName} account.`,
      leave: false,
    };
  }
  return {
    title: 'Restore failed',
    body: `Could not reach the ${storeName} to restore your purchases. Check your connection and try again.`,
    leave: false,
  };
}
// --- END subscriptionResolve ---

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

/** subscriptions row as the client needs it — see supabaseTierQuery. */
interface ServerTierRow {
  tier: SubscriptionTier;
  tierSource: 'revenuecat' | 'manual';
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

  // The server-authoritative tier (subscriptions.tier — pinned for client
  // writes by migration 20260608120000; hand grants are floored by
  // manual_tier, 20260923010000). Three answers, kept distinct because the
  // resolver treats them differently:
  //   ServerTierRow — the row, with end_date honoured the way the edge
  //                   functions' lookupTier (_shared/auth.ts) honours it;
  //   null          — the server answered: there is no row (free);
  //   thrown        — the server did not answer. The query then has no data
  //                   and resolveTier keeps the cached tier instead of
  //                   dropping a hand-granted Pro to Free on a flaky signal.
  const supabaseTierQuery = useQuery<ServerTierRow | null>({
    queryKey: ['subscription-supabase', userId],
    queryFn: async () => {
      if (!userId || !isSupabaseConfigured) return null;
      // select('*') rather than a column list: tier_source only exists once
      // migration 20260923010000 is applied, and naming a missing column
      // would fail the whole read — i.e. put every hand-granted customer
      // back on Free.
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as { tier?: string | null; end_date?: string | null; tier_source?: string | null };
      const ended = !!row.end_date && Date.parse(row.end_date) < Date.now();
      const tier: SubscriptionTier =
        !ended && (row.tier === 'pro' || row.tier === 'business' || row.tier === 'enterprise') ? row.tier : 'free';
      return { tier, tierSource: row.tier_source === 'manual' ? 'manual' : 'revenuecat' };
    },
    enabled: !!userId,
    retry: 1,
  });

  // A plan turned on (or changed) server-side while the app is open reached
  // the phone only after a reinstall: nothing re-read the row. Re-read it
  // whenever the app comes back to the foreground.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void queryClient.invalidateQueries({ queryKey: ['subscription-supabase', userId] });
      }
    });
    return () => sub.remove();
  }, [userId, queryClient]);

  const tierRef = useRef<SubscriptionTier>('free');
  /**
   * resolveTier fed from what the query cache knows RIGHT NOW. Used by the
   * RevenueCat listener and the purchase/restore callbacks, which fire outside
   * a render and must not undo a hand grant (#2: the first RevenueCat push
   * used to drop a manual customer straight back to Free).
   */
  const resolveNow = useCallback((info: CustomerInfo | null): SubscriptionTier => {
    const server = userId
      ? queryClient.getQueryData<ServerTierRow | null>(['subscription-supabase', userId])
      : null; // signed out: there is no server plan, definitively
    return resolveTier({
      rcTier: info ? tierFromCustomerInfo(info) : null,
      serverTier: server === undefined ? undefined : (server?.tier ?? null),
      // The tier the app is on right now is the freshest "last resolved" value.
      localTier: tierRef.current,
      isOwner: isOwner(user?.email),
    });
  }, [queryClient, userId, user?.email]);

  const persistTier = useCallback((t: SubscriptionTier) => {
    tierRef.current = t;
    setTier(t);
    AsyncStorage.setItem(SUBSCRIPTION_KEY, t).catch((err) => {
      console.log('[Subscription] Failed to cache tier:', err);
    });
  }, []);

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
        persistTier('free');
        queryClient.setQueryData(['rc-customer-info'], info);
        console.log('[RC] Logged out of RevenueCat after sign-out');
      } catch (err) {
        console.log('[RC] logOut failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, queryClient, persistTier]);

  useEffect(() => {
    // Wait for the cached tier to be READ before resolving: this effect runs
    // on the first render, and persisting a tier then overwrote the cache with
    // 'free' before localTierQuery had read it — so a hand-granted Pro who
    // opened the app offline lost the only copy of his plan the phone had.
    if (!localTierQuery.isFetched) return;
    // The higher of RevenueCat's entitlement and the server row — see
    // resolveTier (#2). The old "Supabase tier mismatch, trusting RevenueCat"
    // branch also tried to write RevenueCat's tier back to the row; the tier
    // trigger discards a client's tier, so that write never landed, and its
    // log line described a decision that was the bug.
    //
    // Master account override — emails in OWNER_EMAILS (utils/owner.ts)
    // resolve to Business tier regardless of what RevenueCat or Supabase
    // think (applied last inside resolveTier). Lets the platform owner
    // test/demo every paywalled feature without burning real subscriptions.
    const owner = isOwner(user?.email);
    const resolved = resolveTier({
      rcTier: customerInfoQuery.data ? tierFromCustomerInfo(customerInfoQuery.data) : null,
      // null = no plan on the server (no row, or signed out); undefined = the
      // server has not answered yet (loading, offline).
      serverTier: !userId ? null
        : supabaseTierQuery.data === undefined ? undefined : (supabaseTierQuery.data?.tier ?? null),
      localTier: localTierQuery.data ?? null,
      isOwner: owner,
    });
    if (owner) console.log('[Subscription] Master account override active — tier is business');
    persistTier(resolved);
  }, [customerInfoQuery.data, localTierQuery.data, localTierQuery.isFetched, supabaseTierQuery.data, userId, user?.email, persistTier]);

  useEffect(() => {
    if (!rcConfigured) return;
    const listener = (info: CustomerInfo) => {
      console.log('[RC] Customer info updated via listener');
      // Same max as the resolve effect, and the owner override with it —
      // without this, an RC entitlement push (a trial expiring, or simply the
      // first CustomerInfo on launch) knocked a hand-granted customer, or the
      // owner, back down to Free until the next mount.
      const newTier = resolveNow(info);
      persistTier(newTier);
      queryClient.setQueryData(['rc-customer-info'], info);
      if (userId) {
        void syncTierToSupabase(userId, newTier, info.originalAppUserId);
      }
    };
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, [queryClient, userId, resolveNow, persistTier]);

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
      const boughtTier = tierFromCustomerInfo(data.customerInfo);
      console.log('[RC] Purchase successful, new tier:', boughtTier);
      // The conversion event. Previously only STARTED/FAILED were tracked, so
      // successful upgrades were invisible — the funnel dead-ended at intent.
      track(AnalyticsEvents.SUBSCRIPTION_PURCHASED, { tier: boughtTier });
      // Update UI state synchronously so any subscriber re-renders this frame.
      // Resolved, not the bought tier alone: a hand-granted Business customer
      // who buys Pro in the store stays on Business.
      const newTier = resolveNow(data.customerInfo);
      persistTier(newTier);
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

  // #126: there is no store to ask on web or in a keyless build, so say so
  // (RestoreUnavailableError) instead of echoing the local cache back as if it
  // were the store's answer. The mutation's result is the tier the STORE
  // restored — what "restored" means — while the app's own tier is resolved
  // as everywhere else, so a Restore that finds nothing never lowers a plan
  // MAGE ID turned on by hand.
  const restoreMutation = useMutation({
    mutationFn: async (): Promise<{ info: CustomerInfo; restoredTier: SubscriptionTier }> => {
      if (!rcConfigured) throw new RestoreUnavailableError();
      const info = await Purchases.restorePurchases();
      console.log('[RC] Purchases restored');
      return { info, restoredTier: tierFromCustomerInfo(info) };
    },
    onSuccess: ({ info }) => {
      queryClient.setQueryData(['rc-customer-info'], info);
      persistTier(resolveNow(info));
      // A restore onto this account makes RevenueCat send a TRANSFER; the
      // webhook moves the tier server-side. Re-read the row so it shows here.
      if (userId) void queryClient.invalidateQueries({ queryKey: ['subscription-supabase', userId] });
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
      // Customer-safe on purpose (#129): this message used to be a setup
      // instruction ("Set up the product in App Store Connect…") and a screen
      // showed it to the customer verbatim. "not available" is also what
      // components/Paywall.tsx matches to explain the plan honestly.
      throw new Error('Enterprise is not available for purchase in the app yet.');
    }
  }, [enterprisePackage, enterpriseAnnualPackage, purchaseMutation]);

  /** CONTRACT 2: the tier the store restored; throws RestoreUnavailableError where there is no store. */
  const restorePurchases = useCallback(async (): Promise<SubscriptionTier> => {
    const { restoredTier } = await restoreMutation.mutateAsync();
    return restoredTier;
  }, [restoreMutation]);

  // CONTRACT 1 (#176): whether a store subscription backs the tier. Settings
  // uses it to send a store subscriber to the store and a hand-granted one to
  // an email — the store page has nothing for him to cancel.
  const planSource: PlanSource = useMemo(
    () => planSourceFor(tier, storeOfActiveEntitlement(customerInfoQuery.data ?? null, tier)),
    [tier, customerInfoQuery.data],
  );

  // Tier helpers. `isProOrAbove` is the most common gate (paid users), so it
  // includes business + enterprise too. `isBusinessOrAbove` is for features
  // that require business tier as a minimum.
  const isProOrAbove = useMemo(() => tier === 'pro' || tier === 'business' || tier === 'enterprise', [tier]);
  const isBusinessTier = useMemo(() => tier === 'business' || tier === 'enterprise', [tier]);
  const isEnterpriseTier = useMemo(() => tier === 'enterprise', [tier]);
  const isLoading = customerInfoQuery.isLoading || offeringsQuery.isLoading || purchaseMutation.isPending;

  return useMemo(() => ({
    tier,
    planSource,
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
        persistTier(newTier);
      },
    } : {},
  }), [
    tier, planSource, isProOrAbove, isBusinessTier, isEnterpriseTier, isLoading,
    purchasePro, purchaseBusiness, purchaseEnterprise, restorePurchases,
    proPackage, proAnnualPackage, businessPackage, businessAnnualPackage,
    enterprisePackage, enterpriseAnnualPackage,
    offeringsQuery.data, purchaseMutation.isPending, persistTier,
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
