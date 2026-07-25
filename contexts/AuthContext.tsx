import { useState, useEffect, useCallback, useMemo } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { supabase } from '@/lib/supabase';
import { PRIMARY_SCHEME } from '@/utils/deepLinkScheme';
import { processOfflineQueue, getOfflineQueue } from '@/utils/offlineQueue';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { makeRedirectUri } from 'expo-auth-session';
import type { Session, User } from '@supabase/supabase-js';

WebBrowser.maybeCompleteAuthSession();

const AUTH_EMAIL_KEY = 'mageid_auth_email';
const AUTH_PASSWORD_KEY = 'mageid_auth_password';

// AsyncStorage keys that hold per-user app data. Wiped on logout,
// deleteAccount, AND every successful sign-in path so a shared device
// can't leak user-A's projects/DFRs/punch items into user-B's session
// while Supabase is still hydrating the new user's rows.
//
// Keep in sync with the Project/Bids/Companies/Hire context persistence
// layer — adding a new mageid_* prefix without listing it here is how
// cross-tenant leaks happen.
const LOCAL_USER_CACHE_KEYS = [
  'mageid_projects', 'mageid_settings', 'mageid_user_role',
  'mageid_client_rfp_credits_v1', 'mageid_client_sub_state_v1',
  'mageid_leads', 'mageid_bid_packages', 'mageid_bid_package_bids',
  'mageid_change_orders', 'mageid_invoices', 'mageid_daily_reports',
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
  // Community-feed cache. Shared data, but rows carry per-user attribution
  // (userId → public_bids.user_id) that drives the post-quota count — wipe
  // on tenant switch so a signed-out user's posts never count against the
  // next tenant. Re-fetches from public_bids under the incoming JWT.
  'mageid_public_bids',
] as const;

// The re-fetchable caches (mageid_*) are always safe to wipe —
// they rehydrate from Supabase under the incoming JWT. The offline WRITE queue
// (`mageid_offline_queue`) is the ONE cache that CANNOT be re-fetched, so
// dropping it is opt-in. `dropOfflineQueue` defaults to true to preserve the
// existing hard-wipe behavior of login/signup/logout/deleteAccount/OAuth (a
// deliberate sign-out or fresh sign-in where losing the queue is intended).
// Same-user re-auth paths (magic link / password reset) pass false so pending
// offline writes survive — see onNewSessionEstablished.
async function wipeLocalUserCache(opts?: { dropOfflineQueue?: boolean }): Promise<void> {
  const dropOfflineQueue = opts?.dropOfflineQueue ?? true;
  if (dropOfflineQueue) {
    try {
      await AsyncStorage.removeItem('mageid_offline_queue');
    } catch (err) {
      console.log('[Auth] Failed to clear offline queue:', err);
    }
  }
  try {
    await AsyncStorage.multiRemove(LOCAL_USER_CACHE_KEYS as unknown as string[]);
  } catch (err) {
    console.log('[Auth] Failed to clear local data cache:', err);
  }
  // AI result caches — grounded outputs derived from THIS user's bid
  // history / cost book / pace facts / profile:
  //   `mageid_ai_cache_*` (utils/aiService.ts AI_CACHE_PREFIX, e.g.
  //   bidscore_<id>_…) and `mage_ai_cache_*` (utils/mageAI.ts CACHE_PREFIX,
  //   e.g. gen-…, sb_followups_…). They're dynamic-suffix keys, so they
  //   can't live in the static list above; sweep by prefix or a signed-out
  //   user's grounded results replay for the next tenant on a shared device.
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const aiCacheKeys = allKeys.filter(
      k => k.startsWith('mageid_ai_cache_') || k.startsWith('mage_ai_cache_'),
    );
    if (aiCacheKeys.length > 0) await AsyncStorage.multiRemove(aiCacheKeys);
  } catch (err) {
    console.log('[Auth] Failed to clear AI result cache:', err);
  }
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

  // Shared post-sign-in side-effects for any path that establishes a
  // session WITHOUT going through login()/signup() — magic link and
  // password-reset redemption both call supabase.auth.setSession()
  // directly (in _layout.tsx). Those paths must run the same shared-
  // device guard the password/OAuth paths do: wipe the previous user's
  // local cache and clear the react-query cache BEFORE the contexts
  // hydrate, so on a shared device user-B never sees user-A's projects/
  // DFRs/queued mutations flush under B's JWT. Idempotent — safe to call
  // even when the same user re-establishes their own session.
  const onNewSessionEstablished = useCallback(async () => {
    // Re-fetchable caches (projects/DFRs/RFIs + react-query) are always safe to
    // nuke here — they rehydrate from Supabase under the new JWT. But the
    // offline WRITE queue can't be re-fetched: unconditionally dropping it (the
    // old behavior) silently loses pending offline writes when the SAME user
    // re-establishes their session via a magic link or password reset.
    //
    // We can't cleanly read the prior user's id at this call site (the new
    // session's onAuthStateChange has already run by the time this executes,
    // and threading a prior-id through would require a lagging ref plumbed into
    // every sign-in path). So we take the safe queue-preserving route: flush
    // the queue first under the now-active session, then drop it ONLY if the
    // flush fully drained it.
    //   • Same user: their queued writes sync to the server, the queue empties,
    //     and we drop the empty shell — no data lost.
    //   • Different user on a shared device: those writes are rejected by RLS
    //     server-side and discarded via the queue's terminal-error path, so the
    //     queue still empties and gets dropped — no cross-tenant leak.
    //   • Transient network failure mid-flush: writes are re-queued unchanged,
    //     the queue is NOT empty, so we PRESERVE it rather than lose the writes.
    let queueDrained = false;
    try {
      await processOfflineQueue();
    } catch (err) {
      console.log('[Auth] Offline queue flush before wipe failed:', err);
    }
    try {
      // Read the ACTUAL persisted queue (not processOfflineQueue's return
      // value, which short-circuits to remaining:0 when Supabase is
      // unconfigured) so we never drop a still-populated queue.
      queueDrained = (await getOfflineQueue()).length === 0;
    } catch {
      queueDrained = false;
    }
    await wipeLocalUserCache({ dropOfflineQueue: queueDrained });
    queryClient.clear();
    console.log(
      '[Auth] New session established — re-fetchable cache cleared; offline queue',
      queueDrained ? 'flushed + dropped' : 'preserved',
    );
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string, rememberMe: boolean = true) => {
    console.log('[Auth] Logging in');
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

    // Wipe any local cache from a prior session before contexts hydrate.
    // On a shared device, user-B signing in must NOT see user-A's
    // projects/DFRs/RFIs flicker through while Supabase is loading.
    await wipeLocalUserCache();

    const authUser = mapSupabaseUser(data.user);
    queryClient.clear();
    console.log('[Auth] Login successful');
    return authUser;
  }, [queryClient]);

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

    // Same shared-device guard as login — wipe pre-existing local cache
    // before the new user's contexts hydrate so they never momentarily
    // see whoever was on the device before them.
    await wipeLocalUserCache();

    const authUser = mapSupabaseUser(data.user);
    queryClient.clear();
    console.log('[Auth] Signup successful');

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
    // Treat the rest as logout-and-wipe-local — same code path as
    // logout(true) so the device ends up clean. We don't call signOut
    // again because the auth.users row is already gone; getSession()
    // will 401 from this point on.
    try {
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
      // Deep-link back into the app's reset-password screen via the app's
      // mageid:// scheme (app.json `scheme`). Must match a scheme the native
      // binary registers, or the reset link opens nothing — that's why the
      // scheme string is centralized in utils/deepLinkScheme.
      { redirectTo: `${PRIMARY_SCHEME}reset-password` }
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
    console.log('[Auth] Sending magic link to', trimmed);

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
          const { error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: idToken,
          });
          if (error) throw error;
          console.log('[Auth] Google sign-in session set (native flow)');
          await wipeLocalUserCache();
          queryClient.clear();
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
          const { error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: idToken,
          });
          if (error) throw error;
          console.log('[Auth] Google sign-in session set (web GIS flow)');
          await wipeLocalUserCache();
          queryClient.clear();
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
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            });
            if (sessionError) throw sessionError;
            console.log('[Auth] Google sign-in session set successfully');
            await wipeLocalUserCache();
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
        const { error } = await supabase.auth.signInWithIdToken({
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
        await wipeLocalUserCache();
        queryClient.clear();
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
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            });
            if (sessionError) throw sessionError;
            console.log('[Auth] Apple sign-in session set successfully');
            await wipeLocalUserCache();
            queryClient.clear();
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
    deleteAccount,
    loginWithBiometrics,
    resetPassword,
    updatePassword,
    resendConfirmation,
    signInWithGoogle,
    signInWithApple,
    sendMagicLink,
    onNewSessionEstablished,
  }), [user, session, isLoading, isAuthenticated, hasStoredCredentials, login, signup, logout, deleteAccount, loginWithBiometrics, resetPassword, updatePassword, resendConfirmation, signInWithGoogle, signInWithApple, sendMagicLink, onNewSessionEstablished]);
});
