// utils/manageSubscription.ts — where a plan is changed or cancelled (WEBCANCEL,
// 2026-10-09). Pure: no React, no react-native, no store call. The Settings
// row and the paywall both read it through components/ManageSubscriptionRow.
//
// Why. A person who subscribed on the web had one way to cancel: an email to
// help@mageid.app. RevenueCat's customer info carries a `managementURL` (the
// billing page for the active subscription) that no code read. This file
// decides, from what RevenueCat reports, which of these the row is:
//
//   'none'          free, or a master account with no purchase: a plain line,
//                   "there is no paid subscription on this account". No link.
//   'store-here'    bought in this phone's own store: opens that store's
//                   subscription page.
//   'web-portal'    on the web, RevenueCat reports a management URL that is
//                   not a phone store's: opens it in a new tab.
//   'other-apple'   bought in the App Store, seen somewhere else: says so and
//                   links to Apple's subscription page.
//   'other-google'  bought on Google Play, seen on the web: says so and links
//                   to Google Play's subscription page.
//   'elsewhere-web' on a phone, billed on the web: a plain line that says to
//                   manage it in the web app. No link (App Store 3.1.1).
//   'elsewhere'     on a phone, bought in another store: a plain line. An
//                   iPhone build never names another phone platform (2.3.10).
//   'plan-line'     on a phone, a paid plan with no purchase behind it: the
//                   plan's name, nothing to open (3.1.1).
//   'email'         on the web, billed on the web, and RevenueCat reported NO
//                   management URL: the honest fallback, an email.
//   'by-hand'       on the web, a plan MAGE ID turned on: an email.
//
// The app never cancels anything and never says it did. It opens the place
// where the customer does it, then re-reads the customer info.
//
// scripts/validate-manage-subscription.ts executes this file and plants
// mutations in it; scripts/validate-ios-store-copy.ts runs the iPhone states.

export type ManageKind =
  | 'none' | 'store-here' | 'web-portal' | 'other-apple' | 'other-google'
  | 'elsewhere-web' | 'elsewhere' | 'plan-line' | 'email' | 'by-hand';

export type ManageTier = 'free' | 'pro' | 'business' | 'enterprise';

export interface ManageInput {
  /** Platform.OS. */
  os: string;
  tier: ManageTier;
  /** The store of the ACTIVE entitlement behind the tier (RevenueCat `store`), or null. */
  store: string | null | undefined;
  /** RevenueCat CustomerInfo.managementURL. Null when there is no active subscription it can point to. */
  managementURL: string | null | undefined;
  /** utils/owner isOwner: the master-account override has no purchase behind it. */
  isOwner: boolean;
}

export interface ManageRoute {
  kind: ManageKind;
  /** What the row opens. null: nothing to open, the row is a plain line and not a button. */
  url: string | null;
  /** True when the row opens something the customer can cancel in without writing to anyone. */
  selfServe: boolean;
}

export const PLAN_NAME: Record<ManageTier, string> = { free: 'Free', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' };

export const APPLE_SUBSCRIPTIONS_IOS_URL = 'itms-apps://apps.apple.com/account/subscriptions';
export const APPLE_SUBSCRIPTIONS_WEB_URL = 'https://apps.apple.com/account/subscriptions';
export const GOOGLE_PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';
export const SUPPORT_MAILTO = 'mailto:help@mageid.app?subject=Change%20my%20MAGE%20ID%20plan';

/** Stores whose subscription is billed on the web (RevenueCat Web Billing, Stripe, Paddle). */
const WEB_STORES: readonly string[] = ['RC_BILLING', 'STRIPE', 'PADDLE'];

/**
 * The management URL as something safe to open: https only, trimmed. Anything
 * else (null, empty, another scheme) is "RevenueCat reported none".
 */
export function safeManagementUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  return /^https:\/\/[^\s/]+\.[^\s/]+/i.test(url) ? url : null;
}

function hostOf(url: string | null): string {
  if (!url) return '';
  const m = /^https:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}

const isAppleHost = (h: string): boolean => h === 'apple.com' || h.endsWith('.apple.com');
const isGoogleHost = (h: string): boolean => h === 'play.google.com';

/** Where this account's plan is changed or cancelled. See the kinds at the top of the file. */
export function manageSubscriptionRoute(input: ManageInput): ManageRoute {
  const { os, tier } = input;
  const store = input.store ?? null;
  const reported = safeManagementUrl(input.managementURL);
  const host = hostOf(reported);
  const plain = (kind: ManageKind): ManageRoute => ({ kind, url: null, selfServe: false });

  if (tier === 'free') return plain('none');
  // A master account is on Business by override. With no purchase behind it
  // there is nothing to manage; with one, it is a customer like any other.
  if (input.isOwner && !store && !reported) return plain('none');

  if (os === 'ios') {
    if (store === 'APP_STORE') return { kind: 'store-here', url: APPLE_SUBSCRIPTIONS_IOS_URL, selfServe: true };
    if (store && WEB_STORES.includes(store)) return plain('elsewhere-web');
    if (store === 'PLAY_STORE') return plain('elsewhere');
    return plain('plan-line');
  }
  if (os === 'android') {
    if (store === 'PLAY_STORE') {
      return { kind: 'store-here', url: reported && isGoogleHost(host) ? reported : GOOGLE_PLAY_SUBSCRIPTIONS_URL, selfServe: true };
    }
    if (store && WEB_STORES.includes(store)) return plain('elsewhere-web');
    if (store === 'APP_STORE') return plain('elsewhere');
    return plain('plan-line');
  }

  // The web app.
  if (store === 'APP_STORE' || (!store && isAppleHost(host))) {
    return { kind: 'other-apple', url: reported && isAppleHost(host) ? reported : APPLE_SUBSCRIPTIONS_WEB_URL, selfServe: true };
  }
  if (store === 'PLAY_STORE' || (!store && isGoogleHost(host))) {
    return { kind: 'other-google', url: reported && isGoogleHost(host) ? reported : GOOGLE_PLAY_SUBSCRIPTIONS_URL, selfServe: true };
  }
  if (reported && !isAppleHost(host) && !isGoogleHost(host)) return { kind: 'web-portal', url: reported, selfServe: true };
  if (store && WEB_STORES.includes(store)) return { kind: 'email', url: SUPPORT_MAILTO, selfServe: false };
  return { kind: 'by-hand', url: SUPPORT_MAILTO, selfServe: false };
}

export interface RenewalInput {
  /** RevenueCat EntitlementInfo.willRenew of the active entitlement behind the tier. */
  willRenew?: boolean | null;
  /** RevenueCat EntitlementInfo.expirationDate (ISO), or null for a plan with no end. */
  expirationDate?: string | null;
}

export interface RenewalFact {
  /** 'renews': the store says it will renew on `iso`. 'ends': it will not, and access ends on `iso`. */
  kind: 'renews' | 'ends';
  iso: string;
}

/**
 * The one date the row may print, and only when RevenueCat reports it: no
 * entitlement, no date, or a date that does not parse is no line at all.
 */
export function renewalFact(input: RenewalInput | null | undefined): RenewalFact | null {
  if (!input || typeof input.expirationDate !== 'string' || input.expirationDate === '') return null;
  if (typeof input.willRenew !== 'boolean') return null;
  if (Number.isNaN(Date.parse(input.expirationDate))) return null;
  return { kind: input.willRenew ? 'renews' : 'ends', iso: input.expirationDate };
}
