import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { supabase, onSessionExpired } from '@/lib/supabase';
import { PRIMARY_SCHEME } from '@/utils/deepLinkScheme';
import { PENDING_DEEPLINK_KEY } from '@/utils/pendingDeepLink';
import { SIGNUP_INTENT_KEY } from '@/utils/signupIntent';
import { selectTenantKeysToWipe } from '@/utils/localCacheKeys';
import { processOfflineQueue, getOfflineQueue, clearOfflineQueue, retainOfflineQueueForUser } from '@/utils/offlineQueue';
import { processPhotoUploadQueue, clearPhotoUploadQueue, retainPhotoUploadQueueForUser } from '@/utils/photoUploadQueue';
import { track, AnalyticsEvents } from '@/utils/analytics';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { makeRedirectUri } from 'expo-auth-session';
import type { Session, User } from '@supabase/supabase-js';
import { showAlert } from '@/utils/alert';

WebBrowser.maybeCompleteAuthSession();

const AUTH_EMAIL_KEY = 'mageid_auth_email';
const AUTH_PASSWORD_KEY = 'mageid_auth_password';

// ── Who was signed in last on this device (SYNC-F2 / SYNC-F13) ──────────────
// Read BEFORE a sign-in establishes the next session, so that
//   • a DIFFERENT user's arrival wipes the previous tenant's re-fetchable caches
//     before the new session exists (F13 — otherwise the new user's queries can
//     merge the previous tenant's local-only rows under the new account), and
//   • the SAME user signing back in (a session that expired, a biometric
//     re-login) keeps their pending offline field work instead of losing it
//     (F2 — the queue used to be dropped on every sign-in).
// Both keys carry the `mageid_` prefix the tenant sweep owns, so they are
// removed with everything else; wipeLocalUserCache re-writes them on request
// (keepLastUserMarker) for the paths where the identity must outlive the wipe.
const LAST_USER_ID_KEY = 'mageid_last_user_id';
const LAST_USER_EMAIL_KEY = 'mageid_last_user_email';

interface LastUser { id: string; email: string | null }

async function readLastUser(): Promise<LastUser | null> {
  try {
    const pairs = await AsyncStorage.multiGet([LAST_USER_ID_KEY, LAST_USER_EMAIL_KEY]);
    const id = pairs[0]?.[1] ?? null;
    const email = pairs[1]?.[1] ?? null;
    return id ? { id, email } : null;
  } catch {
    return null;
  }
}

async function writeLastUser(user: LastUser | null): Promise<void> {
  if (!user) return;
  try {
    await AsyncStorage.multiSet([
      [LAST_USER_ID_KEY, user.id],
      [LAST_USER_EMAIL_KEY, (user.email ?? '').trim().toLowerCase()],
    ]);
  } catch (err) {
    console.log('[Auth] Failed to record last user:', err);
  }
}

/** What a sign-in path knows about the arriving user BEFORE the session exists. */
interface IncomingIdentity { id?: string | null; email?: string | null }

/** beginSignIn's verdict, carried to the post-session step of the same sign-in. */
export interface SessionHandoff { sameUser: boolean; last: LastUser | null }

function isSameUser(last: LastUser | null, incoming: IncomingIdentity): boolean {
  if (!last) return false;
  if (incoming.id && incoming.id === last.id) return true;
  const email = incoming.email?.trim().toLowerCase();
  return !!email && !!last.email && email === last.email;
}

// The pre-session wipe: re-fetchable caches go, the offline WRITE queues stay
// (decided only once the sign-in has succeeded — a failed attempt by someone
// else must never destroy the previous user's pending work), and the last-user
// marker is re-written so the post-sign-in decision still has its reference.
const PRE_SESSION_WIPE = { dropOfflineQueue: false, keepLastUserMarker: true } as const;

// Base64url → string without relying on a global atob (Hermes has one, older
// runtimes and some polyfill orders do not). ASCII-safe, which is all the
// claims read here (sub / email) need.
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64Decode(input: string): string {
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const ch of input) {
    if (ch === '=') break;
    const v = B64_ALPHABET.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return out;
}

/** Unverified claims of a JWT (a Supabase access token or a Google/Apple id
 *  token) — used ONLY to compare identities locally, never for trust. */
function decodeJwtClaims(token: string | null | undefined): { sub?: string; email?: string } | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(base64Decode(b64)) as { sub?: unknown; email?: unknown };
    return {
      sub: typeof parsed.sub === 'string' ? parsed.sub : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
    };
  } catch {
    return null;
  }
}

// SYNC-F2: sign-out flushes BOTH offline queues first, so the "sync looks
// stuck → sign out and back in" reflex no longer destroys exactly the data
// that was pending. Bounded so a dead uplink cannot hang the sign-out button:
// whatever is still queued after the ceiling is discarded by the wipe, which
// the Settings dialog warned about.
//
// SEQUENTIAL — text mutations first, photo bytes after — never the two raced.
// Since the storage membership policies (20260904100400) a photo upload is
// refused under RLS until its `projects` row exists, so a photo taken on a
// project created offline can only land AFTER this flush has pushed that
// project's upsert. Racing the two (Promise.allSettled, as this used to)
// turned every such photo's one chance before the session died into an RLS
// refusal. Same order OfflineSyncManager (app/_layout.tsx) drains in. The
// ceiling still covers the pair, so the sign-out button cannot hang; a leg
// that throws does not skip the other.
const SIGN_OUT_FLUSH_CEILING_MS = 20_000;
async function flushQueuesBeforeSignOut(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<void>((resolve) => { timer = setTimeout(resolve, SIGN_OUT_FLUSH_CEILING_MS); });
  const flush = (async () => {
    try {
      await processOfflineQueue();
    } catch (err) {
      console.log('[Auth] Offline queue flush before sign-out failed:', err);
    }
    try {
      await processPhotoUploadQueue();
    } catch (err) {
      console.log('[Auth] Photo queue flush before sign-out failed:', err);
    }
  })();
  try {
    await Promise.race([flush, ceiling]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// FALLBACK LIST — not the mechanism any more.
//
// These are the highest-value per-user keys, removed by an explicit
// multiRemove so that they still go even if AsyncStorage.getAllKeys() throws.
// The actual coverage guarantee is the prefix sweep in wipeLocalUserCache
// (utils/localCacheKeys.ts `selectTenantKeysToWipe`), which removes EVERY
// app-owned key without anyone having to remember to enumerate it.
//
// You do NOT need to add a new key here. Keeping the list in sync by hand is
// precisely what failed: ~70 of the app's `mageid_*` keys were never added, and
// the whole `buildwise_*` / `tertiary_*` namespace left by the 2026-07-16
// de-brand was never added either, so logout never cleared any of it.
// scripts/validate-storage-hygiene.ts now asserts the sweep's coverage.
const LOCAL_USER_CACHE_KEYS = [
  'mageid_projects', 'mageid_settings', 'mageid_user_role',
  'mageid_client_rfp_credits_v1', 'mageid_client_sub_state_v1',
  'mageid_leads', 'mageid_bid_packages', 'mageid_bid_package_bids',
  'mageid_change_orders', 'mageid_invoices', 'mageid_daily_reports',
  // T&M / extra-work field tickets. Signed evidence naming a specific owner's
  // rep — never leave it behind on a shared device for the next tenant.
  'mageid_field_tickets',
  // Delay register — the claim-defense spine. Names causation, the owner, and
  // reserved dollar amounts on a specific job, and carries the GC's own
  // contractor_caused admissions. Never leave it on a shared device.
  'mageid_delay_events',
  'mageid_subcontractors', 'mageid_punch_items', 'mageid_photos',
  'mageid_price_alerts', 'mageid_contacts', 'mageid_comm_events',
  'mageid_rfis', 'mageid_submittals', 'mageid_oac_meetings',
  'mageid_cois', 'mageid_equipment', 'mageid_warranties',
  'mageid_portal_messages', 'mageid_commitments', 'mageid_prequal_packets',
  'mageid_drawing_pins', 'mageid_plan_calibrations', 'mageid_plan_sheets',
  'mageid_plan_markups', 'mageid_permits', 'mageid_aia_pay_apps',
  'mageid_sub_portal_links', 'mageid_delay_applied', 'mageid_home_passport',
  'mageid_labor_rates',
  'mageid_material_receipts',
  'mageid_time_entries',
  // Cold-start cost seeds (hooks/useCostSeeds): the rates a contractor pasted
  // or typed to prime their price book before closing a job here. Per-user
  // pricing — must wipe on tenant switch or the next person on a shared device
  // bids at someone else's numbers.
  'mageid_cost_seeds',
  // Community-feed cache. Shared data, but rows carry per-user attribution
  // (userId → public_bids.user_id) that drives the post-quota count — wipe
  // on tenant switch so a signed-out user's posts never count against the
  // next tenant. Re-fetches from public_bids under the incoming JWT.
  'mageid_public_bids',
  // Brain v3: did-for-you append log + morning brief read-cursor.
  // Both are per-user and must wipe on tenant switch.
  'mageid_brain_ledger',
  'mageid_brief_last_seen',
  // Friday Close: week-close read-cursor, leak-CO sweep processed set,
  // autonomy gate pass-state for demotion/promotion transition detection.
  // All three are per-user and must wipe on tenant switch (G12).
  'mageid_week_close_last_seen',
  'mageid_leakco_drafted',
  // Schedule-wizard autosave. Per-user in-progress draft — must wipe on
  // tenant switch or the next person on a shared device resumes your file.
  'mageid_schedule_draft',
  'mageid_autonomy_gate_state',
  // Universal Search: the last 5 search queries (components/UniversalSearch).
  // Queries are per-user (project names, client names) — wipe on tenant switch.
  'mageid_recent_searches',
  // Pending deep-link stash (utils/pendingDeepLink): the in-app route a
  // deauthenticated user was headed to, replayed after sign-in. Per-user
  // by definition (targets protected screens) — wipe on tenant switch so
  // user-A's stashed destination never sends user-B to the wrong screen.
  PENDING_DEEPLINK_KEY,
  // Marketing-site signup intent (utils/signupIntent): the ?plan= & ?trial=
  // params captured from app.mageid.app/?plan=pro&trial=14. Wiped after the
  // paywall consumes it (clearSignupIntent), AND wiped on tenant switch so
  // user-A's intent never pre-selects a plan for user-B on a shared device.
  SIGNUP_INTENT_KEY,
] as const;

// The re-fetchable caches (mageid_*) are always safe to wipe —
// they rehydrate from Supabase under the incoming JWT. The offline WRITE queue
// (`mageid_offline_queue`) is the ONE cache that CANNOT be re-fetched, so
// dropping it is opt-in. `dropOfflineQueue` defaults to true to preserve the
// existing hard-wipe behavior of login/signup/logout/deleteAccount/OAuth (a
// deliberate sign-out or fresh sign-in where losing the queue is intended).
// Same-user re-auth paths (magic link / password reset) pass false so pending
// offline writes survive — see onNewSessionEstablished.
//
// ── How this wipes, and why it is not a list any more ────────────────────────
// The authoritative pass is a PREFIX SWEEP over AsyncStorage.getAllKeys()
// (`selectTenantKeysToWipe`, utils/localCacheKeys.ts). The hand-maintained
// LOCAL_USER_CACHE_KEYS list above kept losing the race: the app writes ~125
// `mageid_*`/`mage_*` keys and the list named ~55 of them, so ~70 per-user keys
// survived every logout — plus the whole `buildwise_*` / `tertiary_*` namespace
// that the 2026-07-16 de-brand renamed in code and abandoned on disk. Under the
// sweep a key is covered the moment it is written, and the only way to exempt
// one is DEVICE_SCOPED_KEYS, in the open, with a reason.
//
// The sweep is prefix-scoped, never AsyncStorage.clear(): on web AsyncStorage
// IS window.localStorage, so getAllKeys() also returns Supabase's own
// `sb-<ref>-auth-token` session plus Stripe/RevenueCat/Sentry state. See the
// header of utils/localCacheKeys.ts.
//
// The explicit multiRemove of LOCAL_USER_CACHE_KEYS is kept as a FALLBACK for
// the one failure mode the sweep has: if getAllKeys() throws, the highest-value
// keys still go. Do NOT add new keys to that list — the sweep already has them.
async function wipeLocalUserCache(opts?: { dropOfflineQueue?: boolean; keepLastUserMarker?: boolean }): Promise<void> {
  const dropOfflineQueue = opts?.dropOfflineQueue ?? true;
  // The marker lives under the swept prefix; read it first when the caller
  // needs the identity to outlive the wipe (pre-session wipe, session expiry).
  const marker = opts?.keepLastUserMarker ? await readLastUser() : null;
  if (dropOfflineQueue) {
    try {
      // The photo-upload queue is governed by the same rule and for the same
      // reason: its entries are pending WRITES that cannot be re-fetched from
      // anywhere. It rides the dropOfflineQueue flag so a same-user re-auth
      // (magic link / password reset) keeps un-uploaded jobsite photos, while a
      // deliberate sign-out still leaves nothing behind for the next tenant.
      //
      // A2 (review 2026-09-05, round 3): emptied through each queue's OWN
      // clear function, never with a multiRemove of its key. Both run under the
      // same lock as their flush's read-modify-write. Removing the key directly
      // lost that race: `flushQueuesBeforeSignOut` is bounded by a 20 s ceiling,
      // a flush that outlives it is still in its network phase holding a
      // snapshot, and its write-back then RE-CREATED the key with the previous
      // tenant's entries seconds after the wipe. Under the lock the write-back
      // reconciles against an empty queue instead and persists nothing.
      // clearPhotoUploadQueue also unlinks the durable copies in
      // documentDirectory — the previous user's jobsite photos.
      await clearOfflineQueue();
      await clearPhotoUploadQueue();
    } catch (err) {
      console.log('[Auth] Failed to clear offline queue:', err);
    }
  }
  try {
    await AsyncStorage.multiRemove(LOCAL_USER_CACHE_KEYS as unknown as string[]);
  } catch (err) {
    console.log('[Auth] Failed to clear local data cache:', err);
  }
  // The sweep. Covers, in one pass and without enumerating anything:
  //   • every `mageid_*` / `mage_*` key the app writes, including the
  //     dynamic-suffix ones no static list could hold — `mageid_ai_cache_*`
  //     (utils/aiService.ts) and `mage_ai_cache_*` (utils/mageAI.ts) grounded
  //     AI outputs, `mageid_copilot_*` histories, `mageid_takeoff::*`;
  //   • the legacy `buildwise_*` / `tertiary_*` residue the de-brand left
  //     behind, which no live code can even read any more;
  //   • the app's few un-namespaced keys (`bids_*`, `post-rfp:draft:*`).
  //
  // A2: the sweep is ALWAYS run with `dropOfflineQueue: false`, whatever this
  // call decided. That is not a change of policy — the two write queues were
  // already emptied above, under their own locks — it is what keeps the queue
  // keys out of this multiRemove, which is the unlocked path a live flush can
  // write back behind. `selectTenantKeysToWipe`'s own default stays `true` for
  // every other caller (see scripts/validate-storage-hygiene.ts).
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const doomed = selectTenantKeysToWipe(allKeys, { dropOfflineQueue: false });
    if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
  } catch (err) {
    console.log('[Auth] Failed to sweep local app storage:', err);
  }
  if (marker) await writeLastUser(marker);
}

// Google OAuth web client ID — same one referenced in the native flow
// for the iOS SDK's webClientId param. Origins (NOT redirect URIs) for
// this client must include every host the app runs on:
//   - https://app.mageid.app
//   - http://localhost:8081 (Expo web dev)
const GOOGLE_WEB_CLIENT_ID = '264795467031-s1ivdn6c68bq4hh464bp0239hkh4k2oa.apps.googleusercontent.com';

// ── Google Identity Services (GIS) loader ───────────────────────────
//
// Loads accounts.google.com/gsi/client and prompts the user to sign in,
// returning the ID token (a signed JWT). Unlike the OAuth redirect flow,
// GIS hands the token directly to the page via a JS callback — no
// redirect URI, so Google's account chooser shows our app's origin
// instead of the Supabase project URL.
//
// We use the explicit "render button + popup" approach via
// google.accounts.id.prompt() because the One Tap UI only renders if the
// user is already signed into Google in the same browser session. The
// fallback is google.accounts.oauth2.initTokenClient with redirect-less
// popup mode — but that returns an access token, not an ID token.
//
// This helper is web-only. Native iOS/Android use the @react-native-
// google-signin SDK already (no Supabase URL ever shown there).

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        ux_mode?: 'popup' | 'redirect';
      }) => void;
      prompt: (cb?: (notification: { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean; getNotDisplayedReason?: () => string; getSkippedReason?: () => string }) => void) => void;
      renderButton: (parent: HTMLElement, opts: Record<string, unknown>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

let gisLoadPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('GIS requires a browser environment.'));
  }
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('GIS script failed to load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('GIS script failed to load.'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

async function promptGoogleIdentityServices(): Promise<string | null> {
  await loadGisScript();
  if (!window.google?.accounts?.id) {
    throw new Error('GIS unavailable after script load.');
  }

  return new Promise<string | null>((resolve, reject) => {
    let settled = false;
    // We render an OFF-SCREEN button and trigger its click programmatically.
    // The official prompt() API is unreliable — it silently no-ops when
    // FedCM is disabled, when the user has dismissed One Tap recently, or
    // when third-party cookies are blocked. The renderButton + click path
    // works in every browser config we've tested.
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:-10000px;opacity:0;pointer-events:none;';
    document.body.appendChild(host);

    const cleanup = () => {
      if (host.parentNode) host.parentNode.removeChild(host);
    };

    window.google!.accounts.id.initialize({
      client_id: GOOGLE_WEB_CLIENT_ID,
      callback: (response) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (response.credential) {
          resolve(response.credential);
        } else {
          resolve(null);
        }
      },
      ux_mode: 'popup',
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    try {
      window.google!.accounts.id.renderButton(host, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
      });
      // Wait one tick for the button to mount, then click it.
      setTimeout(() => {
        const btn = host.querySelector<HTMLElement>('div[role="button"]');
        if (btn) {
          btn.click();
        } else {
          settled = true;
          cleanup();
          reject(new Error('GIS button did not render.'));
        }
      }, 0);
    } catch (e) {
      settled = true;
      cleanup();
      reject(e);
    }

    // Safety timeout — if the user closes the popup without selecting an
    // account, the callback never fires. Give up after 5 minutes so we
    // don't leak the promise and the off-screen host.
    setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(null);
      }
    }, 5 * 60 * 1000);
  });
}

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

// Credential persistence is mobile-only. On web, expo-secure-store v15
// silently falls back to localStorage — which would store the user's
// password in cleartext, readable by any browser extension or DOM-injected
// script. We refuse to persist on web entirely; the user re-authenticates
// each session via Supabase's normal session-cookie flow (which is HTTP-
// only and origin-scoped, far safer than localStorage). The audit caught
// this in May 2026 — pre-fix, web users had passwords sitting in
// `localStorage[mageid_auth_password]` viewable in DevTools.
async function saveCredentials(email: string, password: string): Promise<void> {
  if (Platform.OS === 'web') {
    // Skip silently — the Supabase session cookie persists the auth state
    // and that's all we need on web.
    return;
  }
  try {
    await SecureStore.setItemAsync(AUTH_EMAIL_KEY, email);
    await SecureStore.setItemAsync(AUTH_PASSWORD_KEY, password);
    console.log('[Auth] Credentials saved to SecureStore');
  } catch (err) {
    console.log('[Auth] Failed to save credentials:', err);
  }
}

async function getStoredCredentials(): Promise<{ email: string; password: string } | null> {
  if (Platform.OS === 'web') {
    // Web never stored credentials, so never returns them. The Supabase
    // session is the source of truth.
    return null;
  }
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
  if (Platform.OS === 'web') {
    // Belt-and-suspenders: in case a previous version of the app wrote
    // credentials to localStorage before this guard was added, opportunistically
    // wipe them on logout. localStorage.removeItem is safe even if the keys
    // don't exist.
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(AUTH_EMAIL_KEY);
        window.localStorage.removeItem(AUTH_PASSWORD_KEY);
      }
    } catch { /* ok */ }
    return;
  }
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
  // RT-R1: set when the server rejected the session and a refresh could not
  // save it; the login screen shows it. Cleared by the next established session.
  const [sessionExpiredReason, setSessionExpiredReason] = useState<string | null>(null);
  const expiringRef = useRef(false);
  // A5: true from the sign-out tap until the device is clean, so the UI can
  // disable the button. logoutInFlight is the re-entrancy guard behind it — a
  // second tap while the bounded flush is still running joins the first
  // sign-out instead of starting another flush + signOut + wipe underneath it.
  const [signingOut, setSigningOut] = useState(false);
  const logoutInFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    console.log('[Auth] Initializing Supabase auth listener');

    void supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      console.log('[Auth] Initial session:', currentSession ? 'found' : 'none');
      if (currentSession?.user) {
        setSession(currentSession);
        setUser(mapSupabaseUser(currentSession.user));
        setIsAuthenticated(true);
        // Installs that pre-date the last-user marker: remember who this is,
        // so their first re-auth after the update is recognised as the same
        // user and keeps its pending field work (SYNC-F2). Only when absent —
        // the sign-in paths compare against it and must be the ones to set it.
        //
        // BLOCKING (review 2026-09-05, round 4): NARROW BEFORE STAMPING. Writing
        // the marker is precisely what makes an UNTAGGED queue entry adoptable —
        // a flush treats "no tag + the marker names me" as mine (B1,
        // utils/offlineQueue.partitionQueueForSession) — so stamping it first
        // hands the previous tenant's untagged writes to whoever is signed in
        // now. On a pre-marker web install with a shared browser profile that is
        // a live cross-tenant leak: A's untagged entries sit in the queue with no
        // marker; B opens a recovery link and supabase-js's own
        // detectSessionInUrl swaps the session at CLIENT CONSTRUCTION, before
        // this screen ever mounts; this effect stamps marker = B; and
        // app/reset-password.tsx then calls onNewSessionEstablished() with no
        // handoff, re-reads the marker it just wrote, concludes `sameUser` and
        // never reaches the `last === null` narrowing. The next flush sends A's
        // writes under B's JWT.
        //
        // So: narrow the queues first and stamp the marker only once they can
        // no longer be misread. The backfill's purpose is unchanged: this user
        // is recognised as the same user at their next re-auth, and everything
        // they queue from here on is tagged.
        //
        // …but only the WEB has to pay for it with the untagged entries
        // themselves (A8, round 5). That leak needs a session to change hands
        // before any app code runs, and `detectSessionInUrl` is the only thing
        // that does it — a browser-only feature of supabase-js. On native there
        // is no such door: a session present at mount is whoever last signed in
        // THROUGH this app, and every one of those paths (beginSignIn /
        // beginSessionFromToken → completeSignIn / onNewSessionEstablished)
        // writes the marker. So "no marker" on native means nobody has signed
        // in since the marker shipped, and the untagged entries in the queue are
        // this session's own pending field work — a day of DFRs and photos that
        // used to be deleted, and whose durable photo bytes used to be unlinked,
        // by the mere act of opening the app after an update. Keep them; the
        // marker stamped a line later is what vouches for them. An entry tagged
        // for a DIFFERENT user still goes on both platforms: it could never
        // flush under this session anyway.
        //
        // What makes "nobody else's entries are still here" true on native: the
        // pre-marker build hard-wiped the whole queue on every login / signup /
        // logout (that is the behaviour SYNC-F2 was filed against), so a second
        // user arriving through any of those paths could not leave the first
        // user's writes behind. KNOWN RESIDUAL, accepted: a pre-marker TOKEN
        // redemption (magic link / password reset) by a second user on the same
        // native device whose flush did not drain could. That needs two users,
        // one of them arriving by deep link, an undrained queue, and no ordinary
        // sign-in since — against which the certain cost of narrowing is every
        // native user's pending field work, on the update that ships this.
        //
        // The stricter rule stays on the path where an explicit sign-in says
        // this is NOT the same user (onNewSessionEstablished, marker-less) —
        // there the arriving identity is known, so nothing untagged is theirs.
        const u = currentSession.user;
        void readLastUser().then(async (last) => {
          if (last) return;
          const dropUntagged = Platform.OS === 'web';
          const [text, photos] = await Promise.all([
            retainOfflineQueueForUser(u.id, { dropUntagged }),
            retainPhotoUploadQueueForUser(u.id, { dropUntagged }),
          ]);
          if (text.readFailed || photos.readFailed) {
            // A8: storage refused one of the reads, so that queue is untouched
            // and unexamined. Stamping the marker now would vouch for entries
            // nobody has looked at. Leave it unwritten — the next flush then
            // refuses to adopt anything untagged, and the next mount tries again.
            console.log('[Auth] A write queue could not be read at mount — last-user marker left unwritten');
            return;
          }
          await writeLastUser({ id: u.id, email: u.email ?? null });
        }).catch((err) => {
          // The marker is not written: the next flush keeps refusing to adopt
          // untagged entries, which is the safe direction.
          console.log('[Auth] Failed to backfill the last-user marker:', err);
        });
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
        setSessionExpiredReason(null);
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

  // RT-R1: the server rejected the access token and a refresh did not fix it
  // (lib/supabase.ts). Until now such a session stayed "signed in" forever:
  // every read failed silently, Home showed "All clear", queued writes could
  // never land. Sign out LOCALLY (there is no server session to revoke), keep
  // the pending field work and the last-user marker — this user did not leave,
  // their session died — and tell the login screen why it is showing.
  useEffect(() => {
    // The jest Supabase mock (__tests__/mocks/supabase.ts) has no registry.
    if (typeof onSessionExpired !== 'function') return;
    return onSessionExpired(() => {
      if (expiringRef.current) return;
      expiringRef.current = true;
      void (async () => {
        try {
          console.warn('[Auth] Session rejected by the server and refresh failed — signing out locally');
          try {
            const { error } = await supabase.auth.signOut({ scope: 'local' });
            if (error) console.log('[Auth] Local sign-out after session expiry failed:', error.message);
          } catch (err) {
            console.log('[Auth] Local sign-out after session expiry threw:', err);
          }
          // A4: NO local wipe here. The user whose session died is, as far as
          // this device knows, the one still standing in front of it — wiping
          // their re-fetchable caches AND local-only work products (material
          // cart, scope sheets, takeoffs — see utils/localCacheKeys.ts) for a
          // token rotation would punish them for the server's housekeeping.
          // The queue stays (session-bound: utils/offlineQueue.ts only flushes
          // it under this user's next session) and the last-user marker stays;
          // the next sign-in's identity check (beginSignIn / completeSignIn)
          // is what decides whether a wipe is due, exactly as it does for a
          // normal expiry.
          setSession(null);
          setUser(null);
          setIsAuthenticated(false);
          setSessionExpiredReason('Your session expired — please sign in again.');
          queryClient.clear();
        } finally {
          expiringRef.current = false;
        }
      })();
    });
  }, [queryClient]);

  // SYNC-F13: called by every sign-in path BEFORE it establishes the session.
  // Decides whether the arriving identity is the last user on this device. The
  // caller wipes the previous tenant's re-fetchable caches (PRE_SESSION_WIPE)
  // when it is not — before the new session exists, so the new user's queries
  // cannot merge the previous tenant's local-only rows under the new account.
  const beginSignIn = useCallback(async (incoming: IncomingIdentity): Promise<{ sameUser: boolean; last: LastUser | null }> => {
    const last = await readLastUser();
    const sameUser = isSameUser(last, incoming);
    if (!sameUser) queryClient.clear();
    return { sameUser, last };
  }, [queryClient]);

  // SYNC-F2: after a sign-in succeeded. The SAME user keeps their pending
  // offline queues (they were preserved by the pre-session wipe); a DIFFERENT
  // or unknown user must never flush the previous tenant's writes under this
  // JWT, so the queues are dropped now. Records who is signed in for next time.
  const completeSignIn = useCallback(async (
    signedIn: User | null | undefined,
    handoff: { sameUser: boolean; last: LastUser | null },
  ) => {
    const incoming: LastUser | null = signedIn ? { id: signedIn.id, email: signedIn.email ?? null } : null;
    const sameUser = !!incoming && !!handoff.last && handoff.last.id === incoming.id;
    if (!sameUser) {
      if (handoff.sameUser) {
        // The email matched but the account id did not (re-created account):
        // the pre-session wipe was skipped, so wipe everything now.
        await wipeLocalUserCache();
      } else {
        try {
          // A2: same lock discipline as wipeLocalUserCache — this is the exact
          // window a still-running flush lives in (gotrue's SIGNED_IN fires,
          // and starts a drain, before signInWithPassword resolves here), so
          // removing the keys unlocked is how the previous tenant's entries
          // came back moments after being dropped.
          await clearOfflineQueue();
          await clearPhotoUploadQueue();
        } catch (err) {
          console.log('[Auth] Failed to drop the previous user\'s offline queues:', err);
        }
      }
    }
    await writeLastUser(incoming);
    queryClient.clear();
    console.log('[Auth] Sign-in completed —', sameUser ? 'same user, offline queue kept' : 'tenant switch, offline queue dropped');
  }, [queryClient]);

  // SYNC-F13 for the paths that redeem a token URL THEMSELVES — the magic-link
  // handler in app/_layout.tsx (and password reset) call supabase.auth.
  // setSession() directly. Same order as the password/OAuth paths above: read
  // the arriving identity from the token's claims and, when it is not the last
  // user on this device, deal with the previous tenant BEFORE the session
  // switches. Here that is flush-then-wipe: the previous user's session is
  // still the active one, so their pending offline work lands under THEIR JWT
  // first (bounded, like sign-out); the wipe then clears their re-fetchable
  // caches while keeping the queues and the last-user marker for the
  // post-session decision in onNewSessionEstablished. The wipe used to run
  // only AFTER setSession, so the new user's first queries could merge the
  // previous tenant's local-only rows under the new account.
  const beginSessionFromToken = useCallback(async (accessToken: string | null | undefined): Promise<SessionHandoff> => {
    const claims = decodeJwtClaims(accessToken);
    const handoff = await beginSignIn({ id: claims?.sub, email: claims?.email });
    if (!handoff.sameUser) {
      await flushQueuesBeforeSignOut();
      await wipeLocalUserCache(PRE_SESSION_WIPE);
    }
    return handoff;
  }, [beginSignIn]);

  // Shared post-sign-in side-effects for any path that establishes a
  // session WITHOUT going through login()/signup() — magic link and
  // password-reset redemption both call supabase.auth.setSession()
  // directly (in _layout.tsx). Those paths must run the same shared-
  // device guard the password/OAuth paths do: wipe the previous user's
  // local cache and clear the react-query cache BEFORE the contexts
  // hydrate, so on a shared device user-B never sees user-A's projects/
  // DFRs/queued mutations flush under B's JWT. Idempotent — safe to call
  // even when the same user re-establishes their own session. Pass the
  // handoff from beginSessionFromToken when that pre-session step ran.
  const onNewSessionEstablished = useCallback(async (handoff?: SessionHandoff) => {
    // Re-fetchable caches (projects/DFRs/RFIs + react-query) are always safe to
    // nuke here — they rehydrate from Supabase under the new JWT. The offline
    // WRITE queue can't be re-fetched, so what happens to it depends on WHO
    // just arrived, compared with the last-user marker (SYNC-F2 / SYNC-F13):
    //   • Same user (magic link / password reset for the account already on
    //     this device): flush under the now-active session and KEEP whatever
    //     did not drain — no data lost.
    //   • A different, known-previous user: the previous tenant's writes must
    //     not be replayed under this JWT at all (they would be rejected by RLS
    //     and the new user would see a toast naming the other tenant's tables)
    //     — drop them without flushing here (beginSessionFromToken already
    //     flushed them under the previous session).
    //   • Unknown (no marker yet — an install that pre-dates it): the old
    //     safe route — flush first, drop the queue only if it fully drained.
    // Without a handoff (a caller that could not run the pre-session step)
    // this is the whole guard, just later than ideal.
    let incoming: LastUser | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) incoming = { id: data.session.user.id, email: data.session.user.email ?? null };
    } catch { /* treated as unknown below */ }
    const last = await readLastUser();
    const sameUser = !!incoming && !!last && incoming.id === last.id;
    const knownOtherUser = !!incoming && !!last && !sameUser;

    let keepQueue = false;
    // A8 (round 5): set when a queue could not even be READ. The marker is then
    // left unwritten — see the narrowing block below for why that is what makes
    // keeping the queue safe rather than reckless.
    let markerUnsafe = false;
    if (knownOtherUser) {
      keepQueue = false;
    } else {
      // The pre-session step flushed under the PREVIOUS session for anyone
      // but the same user; the same user's queue drains under the new one.
      if (!handoff || handoff.sameUser) {
        try {
          await processOfflineQueue();
        } catch (err) {
          console.log('[Auth] Offline queue flush before wipe failed:', err);
        }
      }
      try {
        // Read the ACTUAL persisted queue (not processOfflineQueue's return
        // value, which short-circuits to remaining:0 when Supabase is
        // unconfigured) so we never drop a still-populated queue.
        const queue = await getOfflineQueue();
        if (last === null && incoming && !handoff?.sameUser) {
          // A-3: no last-user marker, and nothing has vouched for this being
          // the same user. Only entries TAGGED for the arriving user may
          // survive. An untagged entry would be adopted by the marker written
          // below — the flush treats "no tag + marker names me" as mine — and
          // on a marker-less install it may be another tenant's write. Entries
          // tagged for someone else go too; they could never flush under this
          // session.
          //
          // BLOCKING 2 (review 2026-09-05, round 3): a MISSING handoff counts
          // as "not the same user", exactly like `handoff.sameUser === false`.
          // The condition used to require `handoff && !handoff.sameUser`, so
          // the one caller that cannot run the pre-session step — the web
          // password-reset path in app/reset-password.tsx, which redeems the
          // recovery token through supabase-js's own detectSessionInUrl and
          // reaches here with no handoff at all — fell through to the `else`
          // and kept the WHOLE queue on `queue.length > 0`. On a marker-less
          // install (a fresh browser profile, or storage cleared) that is the
          // previous tenant's queue, adopted by the marker written moments
          // later. The narrowing is the safe default: with no handoff we know
          // less, not more.
          const incomingId = incoming.id;
          try {
            const [text, photos] = await Promise.all([
              // A2: narrowing runs under each queue's own lock, in the queue
              // module that owns the storage key. This used to be an unlocked
              // `AsyncStorage.setItem('mageid_offline_queue', …)` right here —
              // a duplicated key literal, and a plain write that a flush's
              // write-back could clobber (restoring the foreign entries) or be
              // clobbered by (losing this user's own).
              retainOfflineQueueForUser(incomingId),
              retainPhotoUploadQueueForUser(incomingId),
            ]);
            if (text.readFailed || photos.readFailed) {
              // A8 (round 5): storage refused one of the reads. `{kept: 0,
              // dropped: 0}` used to be the only thing that came back from
              // this, and it reads exactly like "there was nothing of theirs
              // here" — so the queue was dropped and the marker stamped over a
              // queue nobody had looked at. Both halves are wrong: KEEP the
              // queue (nothing in it has been shown to belong to anyone else)
              // and leave the marker UNWRITTEN. Those two go together — with no
              // marker, partitionQueueForSession refuses to adopt an untagged
              // entry, so a kept queue cannot leak; stamping while keeping is
              // the one combination that could.
              console.log('[Auth] Marker-less session — a write queue could not be read; keeping both, marker left unwritten');
              keepQueue = true;
              markerUnsafe = true;
            } else {
              keepQueue = text.kept > 0 || photos.kept > 0;
              if (text.dropped > 0 || photos.dropped > 0) {
                console.log('[Auth] Marker-less session — dropped', text.dropped, 'queued mutation(s) and', photos.dropped, 'photo(s) not tagged for this user');
              }
            }
          } catch (err) {
            // Its OWN catch, deliberately: a failed narrowing must fall the
            // other way from the outer one below. If we cannot prove which
            // entries are this user's, keeping them means the marker written
            // moments from now vouches for entries that may be the previous
            // tenant's. Dropping is the safe direction on THIS path.
            console.log('[Auth] Failed to narrow the offline queues to this user; dropping them:', err);
            keepQueue = false;
          }
        } else {
          keepQueue = sameUser || queue.length > 0;
        }
      } catch (err) {
        // Only the `else` path can land here (the narrowing has its own catch
        // above, which falls the other way). Could not even READ the queue:
        // keeping it is right for the same-user re-auth this branch mostly
        // serves — losing un-synced field work to a storage hiccup would be
        // worse — and the flush's own per-entry tag check (B1) still refuses
        // to send another tenant's writes under this JWT.
        console.log('[Auth] Could not decide the offline queue\'s fate; keeping it:', err);
        keepQueue = true;
      }
    }
    await wipeLocalUserCache({ dropOfflineQueue: !keepQueue });
    // A8: not while a queue is unreadable. The marker is what lets a later
    // flush adopt an untagged entry; writing it over a queue this call could
    // not inspect is the leak the narrowing above exists to prevent. The next
    // sign-in re-runs this whole guard against a marker-less device — the safe
    // side to fall on.
    if (markerUnsafe) console.log('[Auth] Last-user marker not written — a write queue was unreadable this session');
    else await writeLastUser(incoming);
    queryClient.clear();
    console.log(
      '[Auth] New session established — re-fetchable cache cleared; offline queue',
      keepQueue ? 'preserved' : 'dropped',
    );
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string, rememberMe: boolean = true) => {
    console.log('[Auth] Logging in');
    const normalizedEmail = email.toLowerCase().trim();
    // SYNC-F13: on a shared device, user-B signing in must NOT see user-A's
    // projects/DFRs/RFIs — and must not have them merged into B's account.
    // The wipe therefore runs BEFORE the session switches, whenever the
    // arriving identity is not the last user on this device.
    const handoff = await beginSignIn({ email: normalizedEmail });
    if (!handoff.sameUser) await wipeLocalUserCache(PRE_SESSION_WIPE);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      console.log('[Auth] Login error:', error.message);
      throw new Error(error.message);
    }

    if (rememberMe) {
      await saveCredentials(normalizedEmail, password);
      setHasStoredCredentials(true);
    }

    // SYNC-F2: same user → pending offline work is kept; different user → the
    // previous tenant's queues are dropped now, before anything can flush them.
    await completeSignIn(data.user, handoff);

    const authUser = mapSupabaseUser(data.user);
    console.log('[Auth] Login successful');
    return authUser;
  }, [beginSignIn, completeSignIn]);

  const signup = useCallback(async (email: string, password: string, name: string) => {
    console.log('[Auth] Signing up');
    // emailRedirectTo controls where Supabase sends the user AFTER they click
    // the email-confirmation link. Without this, Supabase uses the project's
    // Site URL (currently mageid.app — the marketing site), which dumps
    // freshly-confirmed users on the wrong domain. Platform-aware:
    //   - web  → https://app.mageid.app (the actual app)
    //   - native → mageid:// (deep-link back into the installed app)
    const emailRedirectTo = Platform.OS === 'web'
      ? 'https://app.mageid.app/'
      : PRIMARY_SCHEME;
    // SYNC-F13: a new account is (almost always) a different tenant — wipe the
    // previous user's caches BEFORE the session exists.
    const handoff = await beginSignIn({ email: email.toLowerCase().trim() });
    if (!handoff.sameUser) await wipeLocalUserCache(PRE_SESSION_WIPE);
    const { data, error } = await supabase.auth.signUp({
      email: email.toLowerCase().trim(),
      password,
      options: {
        data: { name },
        emailRedirectTo,
      },
    });

    if (error) {
      console.log('[Auth] Signup error:', error.message);
      throw new Error(error.message);
    }

    if (!data.user) {
      throw new Error('Signup succeeded but no user returned. Check your email for verification.');
    }

    // Same shared-device guard as login — the previous tenant's offline queues
    // are dropped now that a different user's session exists.
    await completeSignIn(data.user, handoff);

    const authUser = mapSupabaseUser(data.user);
    console.log('[Auth] Signup successful');
    // Funnel entry — distinct from user_logged_in so signup→activation is
    // measurable (login.tsx only ever emitted logged_in, even for new users).
    track(AnalyticsEvents.USER_SIGNED_UP, { method: 'email' });

    // Fire-and-forget welcome email. Do NOT await — the user has just
    // created their account and should land on the next screen
    // immediately. If the email fails, we log and move on; Supabase's
    // own email-confirmation flow is the source of truth for getting
    // them into the app.
    void (async () => {
      try {
        const { sendEmail, buildWelcomeEmailHtml } = await import('@/utils/emailService');
        const html = buildWelcomeEmailHtml({
          recipientName: name?.trim() || undefined,
        });
        const result = await sendEmail({
          to: email.toLowerCase().trim(),
          subject: 'Welcome to MAGE ID — let\'s get you building',
          html,
          replyTo: 'support@mageid.app',
        });
        if (!result.success) {
          console.warn('[Auth] Welcome email failed to send:', result.error);
        } else {
          console.log('[Auth] Welcome email sent');
        }
      } catch (err) {
        console.warn('[Auth] Welcome email threw:', err);
      }
    })();

    return authUser;
  }, [beginSignIn, completeSignIn]);

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

  const logout = useCallback((clearCredentials: boolean = false): Promise<void> => {
    // A5: a second tap during the bounded flush is a no-op — it joins the
    // sign-out already under way. Two concurrent sign-outs would run the flush
    // race twice and let the second wipe land while the first one's
    // still-running flush writes back into storage.
    if (logoutInFlight.current) return logoutInFlight.current;
    setSigningOut(true);
    const run = (async () => {
      console.log('[Auth] Logging out');
      // SYNC-F2: land what is pending BEFORE the session dies. Sign-out used to
      // drop both offline queues unflushed — the "sync looks stuck, sign out and
      // back in" reflex destroyed exactly the day's field work. Bounded; whatever
      // is still queued afterwards is discarded by the wipe below (the Settings
      // dialog has already said so). Cancel-safe: the ceiling's timer is always
      // cleared, and a flush that outlives the ceiling stops dispatching on its
      // own the moment the session below is gone (utils/offlineQueue.ts B1) —
      // it cannot send anything anonymously or under the next user.
      await flushQueuesBeforeSignOut();
      const { error } = await supabase.auth.signOut();
      if (error) {
        // A FAILED signOut LEAVES THE SESSION ON THE DEVICE. The default scope is
        // 'global', which needs the network; when that call fails the token is
        // still sitting in storage — and on web that storage is
        // window.localStorage, shared per ORIGIN. The UI would show a logged-out
        // app while supabase-js silently restored the previous user's session on
        // the next launch. On a shared office machine that is the wrong person's
        // jobs, costs and client data.
        //
        // scope:'local' does no network round-trip, so it cannot fail the same
        // way. Whatever happened upstream, the local session dies here.
        console.log('[Auth] Logout error, forcing local sign-out:', error.message);
        const { error: localErr } = await supabase.auth.signOut({ scope: 'local' });
        if (localErr) console.warn('[Auth] Local sign-out ALSO failed:', localErr.message);
      }

      if (clearCredentials) {
        await clearStoredCredentials();
        setHasStoredCredentials(false);
      }

      // Drop the offline queue + cached project/sub-collection data so the
      // next user that signs in starts with a clean local cache and pulls
      // their own rows from Supabase. Without this, queued mutations from
      // the previous user would flush under whoever signs in next, and
      // the new user would briefly see the previous user's projects/DFRs/
      // punch items before Supabase responds.
      await wipeLocalUserCache();

      setSession(null);
      setUser(null);
      setIsAuthenticated(false);
      queryClient.clear();
      console.log('[Auth] Logged out');
    })();
    logoutInFlight.current = run.finally(() => {
      logoutInFlight.current = null;
      setSigningOut(false);
    });
    return logoutInFlight.current;
  }, [queryClient]);

  /**
   * Permanently delete the user's account and all of their data.
   * Apple Guideline 5.1.1(v) requires this for any app with sign-in;
   * skipping it = automatic review rejection.
   *
   * Calls the `delete-account` edge function, which runs as service
   * role to wipe the user's rows across every project-scoped table
   * + their storage prefixes + the auth.users record itself. On
   * success we clear local state the same way logout does so the
   * device drops to the login screen with no residue.
   *
   * Throws on failure so the UI can show a useful error toast — the
   * user keeps their account in that case (no half-deleted state).
   */
  const deleteAccount = useCallback(async () => {
    console.log('[Auth] deleteAccount: invoking edge function');
    const { data, error } = await supabase.functions.invoke<{
      success: boolean;
      error?: string;
      tablesCleared?: number;
      tableErrors?: string[];
    }>('delete-account', { method: 'POST' });
    if (error) {
      throw new Error(`Could not delete account: ${error.message}`);
    }
    if (!data?.success) {
      throw new Error(data?.error ?? 'Account deletion failed.');
    }
    console.log('[Auth] deleteAccount: server-side delete complete', data);
    // Treat the rest as logout-and-wipe-local — same code path as logout(true)
    // so the device ends up clean.
    //
    // A LOCAL signOut IS still required, despite the auth.users row being gone.
    // wipeLocalUserCache sweeps the mageid_*/mage_* prefixes and deliberately
    // does NOT touch Supabase's own sb-<ref>-auth-token (clearing that broadly
    // would take out unrelated origin state). So without this the deleted
    // account's JWT stayed in storage — window.localStorage on web, shared per
    // origin — and a page reload rehydrated a zombie session that 401s on every
    // request. The user sees a broken app rather than a clean signed-out one.
    //
    // scope:'local' does no network round-trip, which matters here precisely
    // because there is no longer a server-side user to sign out.
    try {
      const { error: soErr } = await supabase.auth.signOut({ scope: 'local' });
      if (soErr) console.log('[Auth] deleteAccount: local sign-out failed:', soErr.message);
      await clearStoredCredentials();
      setHasStoredCredentials(false);
      await wipeLocalUserCache();
    } catch (err) {
      console.log('[Auth] deleteAccount: local wipe partial:', err);
    }
    setSession(null);
    setUser(null);
    setIsAuthenticated(false);
    queryClient.clear();
  }, [queryClient]);

  const resetPassword = useCallback(async (email: string) => {
    console.log('[Auth] Sending password reset email');
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.toLowerCase().trim(),
      // Platform-aware, exactly like signup()'s emailRedirectTo above. This was
      // unconditionally `mageid://reset-password`, which a desktop browser
      // cannot open — so a web-only user who forgot their password got a dead
      // link while the UI cheerfully told them to check their email. It was the
      // only outbound auth link in this file that was not platform-aware.
      //   - web    → https://app.mageid.app/reset-password
      //   - native → mageid://reset-password (the scheme the binary registers,
      //              centralized in utils/deepLinkScheme)
      {
        redirectTo: Platform.OS === 'web'
          ? 'https://app.mageid.app/reset-password'
          : `${PRIMARY_SCHEME}reset-password`,
      }
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

  // Resend the email-confirmation link for a pending signup. We call this
  // from the post-signup "check your inbox" modal when a user taps "Resend".
  // Supabase rate-limits this (default 1/60s) and returns a clear error if
  // the user has already confirmed — the modal surfaces both states.
  const resendConfirmation = useCallback(async (email: string) => {
    console.log('[Auth] Resending confirmation email');
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.toLowerCase().trim(),
    });
    if (error) {
      console.log('[Auth] Resend error:', error.message);
      throw new Error(error.message);
    }
    console.log('[Auth] Confirmation email resent');
  }, []);

  // Magic email link sign-in. The user enters their email; Supabase
  // emails them a one-tap login link. They tap, the app's deep-link
  // handler in _layout.tsx redeems the access token, and they're in.
  // No password to type, no SMS cost, lower friction than email/pw.
  // If the user doesn't have an account yet, Supabase auto-creates
  // one (we keep `shouldCreateUser: true` so it doubles as a quick
  // signup path).
  const sendMagicLink = useCallback(async (email: string): Promise<void> => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) throw new Error('Enter your email address.');
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!EMAIL_REGEX.test(trimmed)) throw new Error('That email address looks off — please double-check.');
    // Do NOT log `trimmed` (or any other raw identifier) here. Nothing in this
    // app strips console calls from a release bundle — there is no
    // babel-plugin-transform-remove-console in babel.config.js and no
    // drop_console in metro.config.js — so this line used to write the user's
    // email address into iOS os_log on device and into the browser console on
    // app.mageid.app, from the signed-OUT login screen. On a shared or kiosk
    // machine that told the next person who has an account here, before any
    // authentication happened. The rest of this file already logs only
    // outcomes ('found'/'none', error.message), so this was the one leak.
    console.log('[Auth] Sending magic link');

    // Route through our auth-magic-link edge function so the user gets a
    // brand-styled email instead of Supabase's generic "Magic Link →
    // Log In" template. The function calls supabase.auth.admin.generateLink
    // (same magic-link primitive) and then sends a Resend email built
    // from the shared email helpers — same look + feel as DFR / invoice
    // / portal mail.
    //
    // The deep-link target is `redirectUrl`; Supabase appends the access
    // and refresh tokens to the URL fragment. _layout.tsx intercepts via
    // expo-linking and calls setSession.
    const redirectUrl = makeRedirectUri({ preferLocalhost: false });
    const { data, error } = await supabase.functions.invoke('auth-magic-link', {
      body: { email: trimmed, redirectTo: redirectUrl },
    });
    if (error) {
      console.log('[Auth] Magic link edge function error:', error.message);
      throw new Error(error.message);
    }
    if (!data?.ok) {
      const msg = data?.error ?? 'Could not send sign-in email. Please try again.';
      console.log('[Auth] Magic link edge function returned error:', msg);
      throw new Error(msg);
    }
    console.log('[Auth] Magic link sent');
  }, []);

  const signInWithGoogle = useCallback(async () => {
    console.log('[Auth] Starting Google sign-in');
    try {
      // ─── Native iOS / Android flow ───
      // Use the Google Sign-In native SDK so the system in-app sign-in
      // sheet pops up — NO browser, NO "continue to supabase.co" prompt.
      // We get an idToken back, then exchange it via Supabase's
      // signInWithIdToken. Supabase verifies the JWT signature against
      // Google's public keys server-side.
      //
      // Note: Google.signIn() needs to be called AFTER configure().
      // The configuration uses the iOS OAuth client ID we registered
      // in Google Cloud Console with the bundle ID com.mageid.app.
      if (Platform.OS !== 'web') {
        // The entire native flow is wrapped in try/catch — including the
        // import and configure calls. The module references native code
        // (RNGoogleSignin TurboModule) that ONLY exists in builds that
        // bundled the @react-native-google-signin native package
        // (build #8 onward). Older builds (e.g. build #6 + this OTA)
        // will crash at GoogleSignin.configure() because the native
        // module isn't registered. Catching here lets us fall through
        // to the web OAuth path on any failure — including the
        // "module not found" / "native module is null" crash.
        try {
          const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
          GoogleSignin.configure({
            // The iOS OAuth client we registered (lives on our GCP project).
            iosClientId: '264795467031-qi8l5k0iliiqf5fg502jk94pbciu0bkt.apps.googleusercontent.com',
            // The web client is required for offline access / token exchange.
            // Even on iOS we pass the web client ID so the returned idToken
            // has the right `aud` for Supabase's signInWithIdToken.
            webClientId: '264795467031-s1ivdn6c68bq4hh464bp0239hkh4k2oa.apps.googleusercontent.com',
            scopes: ['email', 'profile'],
          });
          await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
          const result = await GoogleSignin.signIn();
          // SDK v13+ returns { type, data: { idToken, user, ... } }.
          // Older shapes returned { idToken, user, ... } directly.
          const idToken = (result as any)?.data?.idToken ?? (result as any)?.idToken;
          if (!idToken) {
            throw new Error('Google did not return an ID token.');
          }
          // SYNC-F13: the id token names the arriving account — wipe the
          // previous tenant BEFORE the session switches when it is not them.
          const handoff = await beginSignIn({ email: decodeJwtClaims(idToken)?.email });
          if (!handoff.sameUser) await wipeLocalUserCache(PRE_SESSION_WIPE);
          const { data, error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: idToken,
          });
          if (error) throw error;
          console.log('[Auth] Google sign-in session set (native flow)');
          await completeSignIn(data.user ?? data.session?.user, handoff);
          return;
        } catch (gErr) {
          const code = (gErr as { code?: string | number })?.code;
          const msg = String((gErr as Error)?.message || gErr || '');
          // User cancellation — silent return, NOT an error to surface.
          if (code === 'SIGN_IN_CANCELLED' || code === '-5' || code === 12501) {
            console.log('[Auth] Google sign-in cancelled');
            return;
          }
          // Native module missing (older binary on top of newer JS bundle).
          // Logged once at info level — falls through to web OAuth which
          // works regardless of binary version.
          if (
            /native module|RNGoogleSignin|null is not an object|TurboModuleRegistry/i.test(msg)
            || msg.includes('Cannot read property') && msg.includes('GoogleSignin')
          ) {
            console.log('[Auth] Google native module not present in this build — using web OAuth');
          } else {
            console.warn('[Auth] Google native sign-in failed, falling back to web:', gErr);
          }
          // Fall through to web OAuth.
        }
      }

      // ─── Web flow: Google Identity Services (ID-token mode) ───
      // The previous web path used Supabase's OAuth redirect, which is
      // why the Google account chooser said "to continue to
      // <project-ref>.supabase.co" — Google literally renders the
      // redirect URI's host. With Google Identity Services (GIS) we use
      // the ID-token flow: GIS returns a signed JWT directly to the
      // page, no redirect, no callback URL exposed. The chooser shows
      // our app's origin (app.mageid.app) instead of Supabase's URL.
      //
      // Then we hand the ID token to supabase.auth.signInWithIdToken;
      // Supabase verifies the signature against Google's public keys
      // and creates the session — same security as the redirect flow.
      //
      // Requirements (already configured in our GCP project):
      //   - Web Client ID listed in code as GOOGLE_WEB_CLIENT_ID
      //   - app.mageid.app + localhost added to Authorized JS origins
      //     on the web client (NOT redirect URIs — origins only)
      if (Platform.OS === 'web') {
        try {
          const idToken = await promptGoogleIdentityServices();
          if (!idToken) {
            console.log('[Auth] GIS sign-in cancelled or empty token');
            return;
          }
          // SYNC-F13: wipe the previous tenant BEFORE the session switches.
          const handoff = await beginSignIn({ email: decodeJwtClaims(idToken)?.email });
          if (!handoff.sameUser) await wipeLocalUserCache(PRE_SESSION_WIPE);
          const { data, error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: idToken,
          });
          if (error) throw error;
          console.log('[Auth] Google sign-in session set (web GIS flow)');
          await completeSignIn(data.user ?? data.session?.user, handoff);
          return;
        } catch (gisErr) {
          // Fall through to the legacy redirect flow if GIS isn't
          // available (script blocked, popup blocker, GCP misconfig).
          // The redirect flow is degraded UX but at least functional.
          console.warn('[Auth] GIS failed, falling back to redirect flow:', gisErr);
        }
      }

      // ─── Legacy redirect flow (last-resort fallback) ───
      // Reached only if GIS failed on web OR the native flow failed for
      // a non-cancellation reason. Shows "continue to supabase.co" but
      // beats no sign-in path.
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
            // SYNC-F13: the access token carries the arriving user id — wipe
            // the previous tenant BEFORE setSession when it is someone else.
            const claims = decodeJwtClaims(accessToken);
            const handoff = await beginSignIn({ id: claims?.sub, email: claims?.email });
            if (!handoff.sameUser) await wipeLocalUserCache(PRE_SESSION_WIPE);
            const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            });
            if (sessionError) throw sessionError;
            console.log('[Auth] Google sign-in session set successfully');
            await completeSignIn(sessionData.user ?? sessionData.session?.user, handoff);
          } else {
            console.log('[Auth] No access token found in Google callback URL');
          }
        }
      }
    } catch (err) {
      console.error('[Auth] Google sign-in error:', err);
      showAlert('Sign In Failed', 'Could not sign in with Google. Please try again.');
      throw err;
    }
  }, [beginSignIn, completeSignIn]);

  const signInWithApple = useCallback(async () => {
    console.log('[Auth] Starting Apple sign-in');
    try {
      // ─── iOS native flow ───
      // Use the system Apple Sign-In sheet (Face ID prompt, no URL
      // shown). We get back an identity token + nonce, then hand them
      // to Supabase via signInWithIdToken — Supabase verifies the JWT
      // signature against Apple's public keys server-side and creates
      // / signs in the user. No browser redirect, no third-party URL
      // prompt, no "wants to use supabase.co" dialog.
      if (Platform.OS === 'ios') {
        const isAvailable = await AppleAuthentication.isAvailableAsync();
        if (!isAvailable) {
          throw new Error('Apple Sign-In is not available on this device.');
        }
        // Apple requires a SHA256 hash of a random nonce. We generate
        // one, hash it, send the hash to Apple, and pass the raw nonce
        // to Supabase along with the identity token so Supabase can
        // verify the binding.
        const rawNonce = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          `${Date.now()}-${Math.random()}-${Math.random()}`,
        );
        const hashedNonce = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          rawNonce,
        );
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          nonce: hashedNonce,
        });
        if (!credential.identityToken) {
          throw new Error('Apple did not return an identity token.');
        }
        // SYNC-F13: wipe the previous tenant BEFORE the session switches.
        const handoff = await beginSignIn({ email: credential.email ?? decodeJwtClaims(credential.identityToken)?.email });
        if (!handoff.sameUser) await wipeLocalUserCache(PRE_SESSION_WIPE);
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
          nonce: rawNonce,
        });
        if (error) throw error;
        // First-time Apple Sign-In returns the user's full name only
        // once. Store it as user metadata so we have something to
        // display besides the email-prefix hack.
        if (credential.fullName?.givenName || credential.fullName?.familyName) {
          const fullName = [credential.fullName.givenName, credential.fullName.familyName]
            .filter(Boolean)
            .join(' ')
            .trim();
          if (fullName) {
            await supabase.auth.updateUser({ data: { name: fullName } }).catch(() => {});
          }
        }
        console.log('[Auth] Apple sign-in session set (native iOS flow)');
        await completeSignIn(data.user ?? data.session?.user, handoff);
        return;
      }

      // ─── Android / web fallback ───
      // Apple's native SDK is iOS-only. Android + web go through
      // Supabase's hosted OAuth callback. The user will see the
      // "wants to use supabase.co" prompt on these platforms — that's
      // unavoidable without a custom domain (paid Supabase plan).
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
            // SYNC-F13: wipe the previous tenant BEFORE setSession when the
            // token's user id is someone else.
            const claims = decodeJwtClaims(accessToken);
            const handoff = await beginSignIn({ id: claims?.sub, email: claims?.email });
            if (!handoff.sameUser) await wipeLocalUserCache(PRE_SESSION_WIPE);
            const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            });
            if (sessionError) throw sessionError;
            console.log('[Auth] Apple sign-in session set successfully');
            await completeSignIn(sessionData.user ?? sessionData.session?.user, handoff);
          } else {
            console.log('[Auth] No access token found in Apple callback URL');
          }
        }
      }
    } catch (err) {
      // User-cancelled is a normal path on iOS — don't show an error.
      const code = (err as { code?: string })?.code;
      if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') {
        console.log('[Auth] Apple sign-in cancelled by user');
        return;
      }
      console.error('[Auth] Apple sign-in error:', err);
      showAlert('Sign In Failed', 'Could not sign in with Apple. Please try again.');
      throw err;
    }
  }, [beginSignIn, completeSignIn]);

  return useMemo(() => ({
    user,
    session,
    isLoading,
    isAuthenticated,
    hasStoredCredentials,
    sessionExpiredReason,
    signingOut,
    login,
    signup,
    logout,
    deleteAccount,
    loginWithBiometrics,
    resetPassword,
    updatePassword,
    resendConfirmation,
    signInWithGoogle,
    signInWithApple,
    sendMagicLink,
    beginSessionFromToken,
    onNewSessionEstablished,
  }), [user, session, isLoading, isAuthenticated, hasStoredCredentials, sessionExpiredReason, signingOut, login, signup, logout, deleteAccount, loginWithBiometrics, resetPassword, updatePassword, resendConfirmation, signInWithGoogle, signInWithApple, sendMagicLink, beginSessionFromToken, onNewSessionEstablished]);
});
