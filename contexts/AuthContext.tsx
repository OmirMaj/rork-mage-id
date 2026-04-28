import { useState, useEffect, useCallback, useMemo } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { supabase } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
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

    // Drop the offline queue — otherwise queued mutations from the previous
    // user can flush under whoever signs in next. Multi-tenant data leak.
    try {
      await AsyncStorage.removeItem('mageid_offline_queue');
    } catch (err) {
      console.log('[Auth] Failed to clear offline queue:', err);
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

  // Resend the email-confirmation link for a pending signup. We call this
  // from the post-signup "check your inbox" modal when a user taps "Resend".
  // Supabase rate-limits this (default 1/60s) and returns a clear error if
  // the user has already confirmed — the modal surfaces both states.
  const resendConfirmation = useCallback(async (email: string) => {
    console.log('[Auth] Resending confirmation email to:', email);
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
    // The `emailRedirectTo` URL is the deep link the user hits when
    // they tap the link from their inbox. Supabase appends the access
    // token + refresh token to the URL fragment; the app intercepts
    // it via expo-linking in _layout.tsx and calls setSession.
    const redirectUrl = makeRedirectUri({ preferLocalhost: false });
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: redirectUrl,
        shouldCreateUser: true,
      },
    });
    if (error) {
      console.log('[Auth] Magic link error:', error.message);
      throw new Error(error.message);
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
        const { GoogleSignin, statusCodes } = await import('@react-native-google-signin/google-signin');
        GoogleSignin.configure({
          // The iOS OAuth client we registered (lives on our GCP project).
          iosClientId: '264795467031-qi8l5k0iliiqf5fg502jk94pbciu0bkt.apps.googleusercontent.com',
          // The web client is required for offline access / token exchange.
          // Even on iOS we pass the web client ID so the returned idToken
          // has the right `aud` for Supabase's signInWithIdToken.
          webClientId: '264795467031-s1ivdn6c68bq4hh464bp0239hkh4k2oa.apps.googleusercontent.com',
          scopes: ['email', 'profile'],
        });
        try {
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
          queryClient.clear();
          return;
        } catch (gErr) {
          const code = (gErr as { code?: string | number })?.code;
          if (code === statusCodes.SIGN_IN_CANCELLED || code === 'SIGN_IN_CANCELLED' || code === '-5') {
            console.log('[Auth] Google sign-in cancelled');
            return;
          }
          // Fall through to web OAuth as a backup.
          console.warn('[Auth] Google native sign-in failed, falling back to web:', gErr);
        }
      }

      // ─── Web fallback ───
      // For web (or if native flow above failed for a non-cancellation
      // reason), use the existing Supabase OAuth flow. This is the
      // path that shows "continue to supabase.co" — unavoidable on web
      // without a custom auth domain.
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
    loginWithBiometrics,
    resetPassword,
    updatePassword,
    resendConfirmation,
    signInWithGoogle,
    signInWithApple,
    sendMagicLink,
  }), [user, session, isLoading, isAuthenticated, hasStoredCredentials, login, signup, logout, loginWithBiometrics, resetPassword, updatePassword, resendConfirmation, signInWithGoogle, signInWithApple, sendMagicLink]);
});
