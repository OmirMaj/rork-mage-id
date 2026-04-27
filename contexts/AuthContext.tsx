import { useState, useEffect, useCallback, useMemo } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
    resendConfirmation,
    signInWithGoogle,
    signInWithApple,
  }), [user, session, isLoading, isAuthenticated, hasStoredCredentials, login, signup, logout, loginWithBiometrics, resetPassword, updatePassword, resendConfirmation, signInWithGoogle, signInWithApple]);
});
