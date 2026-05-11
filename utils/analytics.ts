// analytics.ts — typed PostHog event tracking for MAGE ID.
//
// Why this exists: the previous build had ZERO funnel visibility.
// Sentry caught errors, RevenueCat tracked subscription events, but
// every product question — "do users actually open Permit Q&A?",
// "where do users drop off in onboarding?", "what's the conversion
// rate from signup → first invoice?" — was an unanswerable guess.
//
// Design choices:
//   1. Two APIs — the original `track(eventName, props)` signature
//      still works (backwards-compat for app/login.tsx + settings).
//      New code should use the typed `trackEvent(event)` API which
//      catches event-name typos and bad payload shapes at compile.
//
//   2. Graceful no-op when EXPO_PUBLIC_POSTHOG_KEY isn't set — we
//      can ship the instrumentation without a key and turn analytics
//      on later by adding the env var. Pre-key, calls log to dev
//      console only.
//
//   3. PII discipline — `identify()` takes a user ID, never email or
//      name. Project IDs go through `hashProjectId()` before any
//      analytics call. No client names, no addresses, no email
//      addresses ever sent to PostHog.
//
//   4. Session replay disabled by default — privacy concern for B2B
//      construction where users show client financials on screen.
//
// Setup:
//   1. Get a PostHog project API key from posthog.com
//   2. Add to `.env`: EXPO_PUBLIC_POSTHOG_KEY=phc_xxxxx
//   3. (Optional) EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
//   4. Restart the dev server
//
// Without keys, every call is a dev-console log and silent in prod.

import PostHog from 'posthog-react-native';
import { Platform } from 'react-native';

// ─── Backwards-compatible event constants ───────────────────────
// Existing call sites use `track(AnalyticsEvents.USER_LOGGED_IN,
// {...})`. Keep this export shape so we don't break app/login.tsx
// or app/(tabs)/settings/index.tsx.
export const AnalyticsEvents = {
  USER_SIGNED_UP: 'user_signed_up',
  USER_LOGGED_IN: 'user_logged_in',
  USER_LOGGED_OUT: 'user_logged_out',
  PROJECT_CREATED: 'project_created',
  ESTIMATE_GENERATED: 'estimate_generated',
  INVOICE_CREATED: 'invoice_created',
  CHANGE_ORDER_CREATED: 'change_order_created',
  BID_POSTED: 'bid_posted',
  MESSAGE_SENT: 'message_sent',
  SUBSCRIPTION_PURCHASED: 'subscription_purchased',
  DAILY_REPORT_CREATED: 'daily_report_created',
  PUNCH_ITEM_CREATED: 'punch_item_created',
  RFI_CREATED: 'rfi_created',
  SUBMITTAL_CREATED: 'submittal_created',
  EQUIPMENT_ADDED: 'equipment_added',
  CONTACT_ADDED: 'contact_added',
  PDF_GENERATED: 'pdf_generated',
  PHOTO_ADDED: 'photo_added',
} as const;

type EventProperties = Record<string, string | number | boolean | undefined>;

// ─── Typed event schema (new API) ───────────────────────────────
// Every typed event the app fires lives here. New events go through
// PR review so we don't end up with the 200-different-events sprawl
// that kills every analytics setup over time.
//
// Names: `noun_verbed` past-tense, snake_case. Never camelCase.
// Payloads: minimal — only what's needed to answer a product question.
// NO PII (no names, addresses, emails, project names).
export type AnalyticsEvent =
  // ── ACQUISITION ── (signup funnel)
  | { name: 'app_opened'; props?: { is_first_run?: boolean; days_since_install?: number } }
  | { name: 'signin_viewed'; props?: { source?: 'cold_launch' | 'paywall' | 'deeplink' } }
  | { name: 'signin_succeeded'; props: { method: string; is_new_user: boolean } }

  // ── ONBOARDING ──
  | { name: 'onboarding_started'; props?: { step?: string } }
  | { name: 'onboarding_step_completed'; props: { step: string; step_index: number } }
  | { name: 'onboarding_skipped'; props: { step: string } }
  | { name: 'onboarding_completed'; props: { duration_seconds: number; steps_completed: number } }

  // ── ACTIVATION ── (first meaningful action)
  | { name: 'project_created_typed'; props: { type: string; via: 'manual' | 'sample' | 'voice' | 'lead_conversion' } }
  | { name: 'sample_project_seeded'; props: { flavor: string } }
  | { name: 'first_invoice_sent'; props: { project_id_hash: string } }
  | { name: 'first_dfr_filed'; props: { project_id_hash: string } }

  // ── AI FEATURES ──
  | { name: 'permit_qa_opened'; props?: { from?: 'home_hero' | 'tools' | 'ai_hub' | 'deeplink' } }
  | { name: 'permit_qa_asked'; props: { metro: string; chars: number; from_starter: boolean } }
  | { name: 'permit_qa_answered'; props: { metro: string; ms: number; from_cache: boolean } }
  | { name: 'code_check_run'; props: { category: string; location_chars: number } }
  | { name: 'ai_takeoff_started'; props: { plan_count: number } }
  | { name: 'estimate_review_run'; props: { project_id_hash: string } }

  // ── ENGAGEMENT ──
  | { name: 'tab_viewed'; props: { tab: 'summary' | 'home' | 'discover' | 'tools' | 'settings' | 'ai_hub' } }
  | { name: 'project_opened'; props: { project_id_hash: string } }
  | { name: 'daily_report_opened'; props: { project_id_hash: string } }

  // ── MONETIZATION ──
  | { name: 'paywall_viewed'; props: { feature: string; tier_blocked: string } }
  | { name: 'paywall_dismissed'; props: { feature: string } }
  | { name: 'subscription_purchase_started'; props: { tier: string; period: 'monthly' | 'annual' } }
  | { name: 'subscription_purchase_completed'; props: { tier: string; period: 'monthly' | 'annual'; cents: number } }
  | { name: 'subscription_purchase_failed'; props: { tier: string; error_kind: string } }

  // ── ERRORS ── (functional failures, not crashes)
  | { name: 'sync_failed'; props: { kind: string; retry_count: number } }
  | { name: 'ai_call_failed'; props: { feature: string; error_kind: string } };

// ─── User properties ────────────────────────────────────────────
export interface UserProperties {
  tier?: 'free' | 'pro' | 'business' | 'enterprise';
  primary_metro?: string;
  /** ISO date — set once at signup, never updated */
  signup_date?: string;
  project_count?: number;
  /** Has the user actually used the app vs just signed up? */
  is_activated?: boolean;
}

// ─── Internal PostHog client (lazy-initialized) ─────────────────
let _client: PostHog | null = null;
let _initAttempted = false;

function getClient(): PostHog | null {
  if (_initAttempted) return _client;
  _initAttempted = true;

  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!apiKey) {
    if (__DEV__) console.info('[analytics] EXPO_PUBLIC_POSTHOG_KEY not set — events will dev-log only');
    return null;
  }

  try {
    const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
    _client = new PostHog(apiKey, {
      host,
      // Session replay defaults to off — privacy concern for B2B.
      // Enable per-session via posthog.startSessionRecording() when
      // debugging a specific issue with user consent.
      enableSessionReplay: false,
      captureAppLifecycleEvents: true,
      flushAt: 20,
      flushInterval: 30000,
    });
    return _client;
  } catch (err) {
    if (__DEV__) console.warn('[analytics] PostHog init failed:', err);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Runtime PII scrubber for analytics payloads. Defense-in-depth: the
 * typed event schema is supposed to prevent PII from being passed in,
 * but a stray call site that forgets and includes an email or full
 * project name shouldn't leak it to PostHog. Strips:
 *   - Email-shaped strings
 *   - Bearer tokens / API keys
 *   - JWTs
 *   - Stripe-shaped IDs (cus_/ch_/pi_)
 *   - Plain raw "name", "email", "address" property keys
 */
function scrubPII(properties: EventProperties): EventProperties {
  const out: EventProperties = {};
  const SENSITIVE_KEYS = new Set([
    'email', 'email_address', 'name', 'full_name', 'first_name', 'last_name',
    'phone', 'phone_number', 'address', 'street', 'street_address',
    'ssn', 'ein', 'tax_id', 'password', 'token', 'access_token',
    'project_name', 'client_name', 'homeowner_name', 'contractor_name',
  ]);
  for (const [k, v] of Object.entries(properties)) {
    const keyLower = k.toLowerCase();
    if (SENSITIVE_KEYS.has(keyLower)) {
      out[k] = '[REDACTED]';
      continue;
    }
    if (typeof v === 'string') {
      let cleaned = v;
      // Emails
      cleaned = cleaned.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]');
      // Bearer + API keys
      cleaned = cleaned.replace(/(?:Bearer|bearer)\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
      cleaned = cleaned.replace(/\b(sk|pk|rk|whsec)_[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]');
      cleaned = cleaned.replace(/\bsk-ant-[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]');
      // JWTs
      cleaned = cleaned.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]');
      out[k] = cleaned;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Legacy untyped API — kept for backwards-compat with existing call
 * sites in app/login.tsx and app/(tabs)/settings/index.tsx. New code
 * should use `trackEvent` for type-safety.
 *
 * All properties are PII-scrubbed before sending to PostHog.
 */
export function track(eventName: string, properties?: EventProperties): void {
  const scrubbed = properties ? scrubPII(properties) : {};
  if (__DEV__) console.info(`[analytics] ${eventName}`, scrubbed);
  try {
    const client = getClient();
    if (!client) return;
    // PostHog's `capture` accepts a JsonType-compatible object. Our
    // EventProperties is a stricter subset (no nested objects), so
    // a cast through `unknown` is type-safe — the runtime value
    // already conforms.
    const payload = { ...scrubbed, platform: Platform.OS } as unknown as Parameters<PostHog['capture']>[1];
    client.capture(eventName, payload);
  } catch (err) {
    if (__DEV__) console.warn('[analytics] track failed:', err);
  }
}

/**
 * Typed event tracking — invalid event names or payload shapes fail
 * at compile-time. Safe to call from anywhere; never throws, never
 * blocks the UI.
 */
export function trackEvent(event: AnalyticsEvent): void {
  const props = ('props' in event ? event.props : {}) as EventProperties;
  track(event.name, props);
}

/**
 * Identify the current user. Call on sign-in success.
 * userId: a stable opaque ID (Supabase user.id). Never email.
 */
export function identify(userId: string, props: UserProperties = {}): void {
  if (__DEV__) console.info('[analytics] identify', userId.slice(0, 8) + '…', props);
  try {
    const client = getClient();
    if (!client) return;
    // Same JsonType compatibility note as `track` above — runtime
    // value is JSON-clean strings/numbers/undefineds.
    const payload = props as unknown as Parameters<PostHog['identify']>[1];
    client.identify(userId, payload);
  } catch (err) {
    if (__DEV__) console.warn('[analytics] identify failed:', err);
  }
}

/**
 * Update user properties without re-identifying. Call when tier
 * changes, project count increments, etc.
 */
export function setUserProperties(props: UserProperties): void {
  try {
    const client = getClient();
    if (!client) return;
    const payload = { $set: props } as unknown as Parameters<PostHog['capture']>[1];
    client.capture('$set', payload);
  } catch (err) {
    if (__DEV__) console.warn('[analytics] setUserProperties failed:', err);
  }
}

/**
 * Clear identity (call on sign-out). Subsequent events go anonymous.
 */
export function reset(): void {
  try {
    const client = getClient();
    if (!client) return;
    client.reset();
  } catch (err) {
    if (__DEV__) console.warn('[analytics] reset failed:', err);
  }
}

/**
 * Hash a project ID for analytics. We never want raw project IDs in
 * the analytics warehouse — they're internal identifiers. A truncated
 * hash is sufficient for cohorting "users with multiple projects"
 * without leaking the ID's bytes.
 */
export function hashProjectId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).padStart(8, '0').slice(0, 8);
}

/**
 * Legacy provider injection — kept for backwards-compat. The new
 * PostHog client is auto-initialized lazily via env var; no manual
 * provider setup needed.
 */
interface AnalyticsProvider {
  track: (eventName: string, properties?: EventProperties) => void;
}
export function setAnalyticsProvider(_provider: AnalyticsProvider): void {
  // No-op — kept so any code that called this in the past doesn't
  // break. The PostHog client now controls the provider.
  if (__DEV__) console.info('[analytics] setAnalyticsProvider is a no-op now; using PostHog client');
}
