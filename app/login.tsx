import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Animated, ActivityIndicator, Switch,
  Easing, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { HardHat, Mail, Lock, Eye, EyeOff, ArrowRight, ScanFace, KeyRound, Chrome, CheckCircle2 } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { track, AnalyticsEvents } from '@/utils/analytics';
import { Type } from '@/constants/typography';
import { neutralInk, cardSurface } from '@/components/ui';
import { Motion, Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import {
  AuthSubmitButton, FieldRing, Slot, useLaunchEntrance, useLaunchTarget, usePressSpring,
} from '@/components/auth/authMotion';
import { layoutNext, nativeDriver, reducedMotion, useSwapFade } from '@/components/ui/motion';
import {
  INVITE_PARAM, postSignInHref, signupHrefForInvite, sanitizeInviteToken, signInElsewhereAction, markInviteTokenHandled,
} from '@/utils/deepLinksInvite';

let _LocalAuthentication: typeof import('expo-local-authentication') | null = null;

// Lightweight client-side email format check so a typo'd address gets
// immediate feedback instead of a false "check your inbox." Mirrors the
// server-side regex in AuthContext.sendMagicLink; the backend remains the
// authoritative validator.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// The wordmark while the splash's own "MAGE ID" is still flying onto it.
const HIDDEN = { opacity: 0 } as const;

// "Sign in with password instead": the block fades in and rises the last few
// points, then the password field takes focus (native only).
// hoist into Motion.duration after round 3
const PASSWORD_REVEAL_MS = 200;
// hoist into Motion.duration after round 3
const PASSWORD_FOCUS_MS = 60;
const PASSWORD_RISE = 8;

type Reveal = { opacity: Animated.Value; translateY: Animated.Value; style: ViewStyle };

// #108: the session came from another tab, whose gate opens this invite for a
// new account. Hedged on purpose: a set-up account is not redirected there, so
// the card on Home is named as the other way in rather than promising the tab.
const LOGIN_INVITE_OPENED_ELSEWHERE =
  "You're signed in from another tab. Your invite opens there, or accept it from the invites card on Home. You can close this tab.";

export default function LoginScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Cold-start hand-off from BrandSplash (components/auth/authMotion). Unarmed
  // (and the tree unchanged) on every mount but the one under the splash.
  const entrance = useLaunchEntrance(9);
  const launchTarget = useLaunchTarget();
  // A collaboration invite the user opened before signing in rides this param
  // (utils/deepLinksInvite). A successful sign-in goes back to the invite
  // instead of Summary — the stored token never survived the round trip.
  const inviteParams = useLocalSearchParams<{ [INVITE_PARAM]?: string }>();
  const inviteToken = inviteParams[INVITE_PARAM];
  // #7: every caller reaches this AFTER the sign-in succeeded. A navigation
  // failure is therefore not a failed sign-in, and must never reach the
  // handler's catch — that fired an error haptic straight after the success
  // haptic and set an error banner on a screen that was already leaving. The
  // root gate routes from wherever a failure leaves him.
  const goAfterSignIn = useCallback(() => {
    try {
      router.replace(postSignInHref(inviteToken, '/(tabs)/summary') as never);
    } catch (navErr) {
      console.log('[Login] Post-sign-in navigation failed; the root gate takes it from here:', navErr);
    }
  }, [router, inviteToken]);
  const { login, loginWithBiometrics, resetPassword, hasStoredCredentials, signInWithGoogle, signInWithApple, sendMagicLink, sessionExpiredReason, isAuthenticated, isLoading: authLoading, session } = useAuth();
  // #93: the root gate no longer routes an authenticated user off an
  // invite-bearing /login (it raced this screen's own navigation and could
  // bounce a new account to /persona-select, dropping the token). So the one
  // case this screen must cover itself: a session that was ALREADY there when
  // auth finished loading (restored onto /login?invite=…), with no sign-in
  // here to navigate. Decided once, on the first settled read — a sign-in
  // started on this screen navigates through goAfterSignIn, not this.
  const restoredCheckedRef = useRef(false);
  useEffect(() => {
    if (authLoading || restoredCheckedRef.current) return;
    restoredCheckedRef.current = true;
    if (isAuthenticated && sanitizeInviteToken(inviteToken)) goAfterSignIn();
  }, [authLoading, isAuthenticated, inviteToken, goAfterSignIn]);

  // True while a sign-in started on THIS screen is running (a ref: the auth
  // flip lands inside the handler's await, before a state update is visible).
  const localSignInRef = useRef(false);

  // #108: a session that arrives from ANOTHER tab while this one sits on
  // /login?invite=… (supabase-js broadcasts SIGNED_IN across tabs). The root
  // gate leaves an invite-bearing auth screen to the screen, and the check
  // above decides only on the first settled read — so this tab, the one that
  // still has the token, stayed put. A false→true flip after that read, with a
  // valid token and no sign-in of our own in flight (those navigate
  // themselves), finishes the invite from here.
  //
  // Unless the account carries this SAME token in user_metadata (an email
  // sign-up from this invite): the other tab's root gate opens it then, and a
  // second accept from here would fail as "already used" in whichever tab lost
  // (utils/deepLinksInvite signInElsewhereAction). This tab stands down, marks
  // the token handled so its own gate can't open it too, and says where it went.
  const prevAuthRef = useRef<boolean | null>(null);
  const [elsewhereNotice, setElsewhereNotice] = useState('');
  useEffect(() => {
    if (authLoading) return;
    const was = prevAuthRef.current;
    prevAuthRef.current = isAuthenticated;
    if (was !== false || !isAuthenticated || localSignInRef.current) return;
    const action = signInElsewhereAction({
      routeToken: inviteToken,
      accountMeta: session?.user?.user_metadata,
      sharedOriginTabs: Platform.OS === 'web',
    });
    if (action === 'none') return;
    markInviteTokenHandled(inviteToken);
    if (action === 'opened_in_other_tab') {
      setElsewhereNotice(LOGIN_INVITE_OPENED_ELSEWHERE);
      return;
    }
    goAfterSignIn();
  }, [authLoading, isAuthenticated, inviteToken, goAfterSignIn, session]);

  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isAppleLoading, setIsAppleLoading] = useState(false);
  const [isMagicLinkLoading, setIsMagicLinkLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // Password mode is opt-in now — Apple / Google / magic link are the
  // primary paths. Tapping "Sign in with password" expands the
  // password fields.
  const [showPasswordMode, setShowPasswordMode] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  const press = usePressSpring();
  const passwordRef = useRef<TextInput>(null);

  // Form motion (slick round 3, lane A2). A field's ring: accent while it has
  // focus, danger when the last attempt named it empty / malformed (danger
  // outranks focus; an edit of that field clears it). A server error names no
  // field. The Sign In button morphs label → spinner → check.
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [emailDanger, setEmailDanger] = useState(false);
  const [passwordDanger, setPasswordDanger] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  // goAfterSignIn swallows a failed navigation and the root gate may leave
  // him here (#93); a button that stayed on its check would be dead. Still
  // mounted a few seconds after success → give the button back.
  useEffect(() => {
    if (!signedIn) return undefined;
    const t = setTimeout(() => setSignedIn(false), 4000);
    return () => clearTimeout(t);
  }, [signedIn]);
  const [passwordReveal, setPasswordReveal] = useState<Reveal | null>(null);
  const submitPhase = signedIn ? 'done' : isSubmitting ? 'loading' : 'idle';

  // Every banner change goes through here: when it shows or hides, the rows
  // below ease to their new place (layoutNext; native only) instead of jumping.
  const errorShownRef = useRef(false);
  const setError = useCallback((msg: string) => {
    const flips = !!msg !== errorShownRef.current;
    errorShownRef.current = !!msg;
    if (flips) layoutNext();
    setErrorMessage(msg);
  }, []);
  // The banner fades in (160 ms) whenever a new message arrives. Null at rest.
  const bannerFade = useSwapFade(errorMessage);
  // "Check your inbox" and the send button swap with a fade. Null at rest.
  const magicSwap = useSwapFade(magicLinkSent ? 'sent' : 'idle');

  const openPasswordMode = useCallback(() => {
    if (!reducedMotion()) {
      const opacity = new Animated.Value(0);
      const translateY = new Animated.Value(PASSWORD_RISE);
      setPasswordReveal({ opacity, translateY, style: { opacity, transform: [{ translateY }] } });
    }
    layoutNext();
    setShowPasswordMode(true);
  }, []);

  useLayoutEffect(() => {
    if (!showPasswordMode) return undefined;
    if (passwordReveal) {
      Animated.parallel([
        Animated.timing(passwordReveal.opacity, {
          toValue: 1, duration: PASSWORD_REVEAL_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
        }),
        Animated.spring(passwordReveal.translateY, { toValue: 0, ...Motion.spring.rise, useNativeDriver: nativeDriver }),
      ]).start();
    }
    if (Platform.OS === 'web') return undefined;
    const t = setTimeout(() => passwordRef.current?.focus(), PASSWORD_FOCUS_MS);
    return () => clearTimeout(t);
  }, [showPasswordMode, passwordReveal]);

  // RT-R1: the app landed here because the server rejected the session and a
  // refresh could not save it (AuthContext). Say so — a silent bounce to the
  // sign-in screen reads as a crash. Cleared like any other error on the next
  // attempt.
  useEffect(() => {
    if (sessionExpiredReason) setError(sessionExpiredReason);
  }, [sessionExpiredReason, setError]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const checkBiometrics = async () => {
      try {
        const mod = await import('expo-local-authentication');
        _LocalAuthentication = mod;
        const compatible = await mod.hasHardwareAsync();
        const enrolled = await mod.isEnrolledAsync();
        console.log('[Login] Biometrics hardware:', compatible, 'enrolled:', enrolled);
        setBiometricsAvailable(compatible && enrolled);
      } catch (err) {
        console.log('[Login] Biometrics check failed:', err);
      }
    };
    void checkBiometrics();
  }, []);

  const handleBiometricLogin = useCallback(async () => {
    if (!hasStoredCredentials) {
      showAlert(
        'No Stored Credentials',
        'Please log in with your email and password first. After a successful login with "Remember me" enabled, you can use biometrics next time.'
      );
      return;
    }

    setIsBiometricLoading(true);
    localSignInRef.current = true;
    try {
      await loginWithBiometrics();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      track(AnalyticsEvents.USER_LOGGED_IN, { method: 'biometric' });
      goAfterSignIn();
    } catch (err) {
      console.log('[Login] Biometric auth failed:', err);
      const msg = err instanceof Error ? err.message : 'Biometric authentication failed.';
      showAlert('Authentication Failed', msg);
    } finally {
      localSignInRef.current = false;
      setIsBiometricLoading(false);
    }
  }, [hasStoredCredentials, loginWithBiometrics, goAfterSignIn]);

  const handleLogin = useCallback(async () => {
    setError('');

    const emailEmpty = !email.trim();
    const passwordEmpty = !password.trim();
    if (emailEmpty || passwordEmpty) {
      setEmailDanger(emailEmpty);
      setPasswordDanger(passwordEmpty);
      setError('Please fill in all fields');
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }
    setEmailDanger(false);
    setPasswordDanger(false);

    setIsSubmitting(true);
    localSignInRef.current = true;

    try {
      await login(email.trim(), password, rememberMe);
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      track(AnalyticsEvents.USER_LOGGED_IN, { method: 'email' });
      // The button lands on its check as the screen goes (no hold).
      setSignedIn(true);
      goAfterSignIn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(message);
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      localSignInRef.current = false;
      setIsSubmitting(false);
    }
  }, [email, password, rememberMe, login, goAfterSignIn, setError]);

  // Distinguish a normal user-cancel (closed the account chooser / dismissed
  // the Face ID sheet) from a real failure. Cancels are silent; real failures
  // surface the same inline error banner + error haptic as the email / magic-
  // link paths so a failed tap never looks like nothing happened. The auth
  // context already returns without throwing on most cancels, but we guard the
  // known cancel shapes here too in case one bubbles up.
  const isUserCancel = useCallback((err: unknown): boolean => {
    if (!err || typeof err !== 'object') return false;
    if ('userCancelled' in err && (err as { userCancelled?: boolean }).userCancelled) return true;
    const code = (err as { code?: string | number }).code;
    return (
      code === 'ERR_REQUEST_CANCELED' ||
      code === 'ERR_CANCELED' ||
      code === 'SIGN_IN_CANCELLED' ||
      code === '-5' ||
      code === 12501
    );
  }, []);

  const handleGoogleLogin = useCallback(async () => {
    setIsGoogleLoading(true);
    setError('');
    localSignInRef.current = true;
    try {
      // #159: false = he closed the Google sheet (or it came back empty).
      // No session exists, so no success haptic, no USER_LOGGED_IN, no
      // navigation — he stays on this screen.
      const signedIn = await signInWithGoogle();
      if (!signedIn) return;
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      track(AnalyticsEvents.USER_LOGGED_IN, { method: 'google' });
      goAfterSignIn();
    } catch (err) {
      console.log('[Login] Google login failed:', err);
      if (isUserCancel(err)) return;
      setError("Couldn't sign in with Google. Please try again.");
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      localSignInRef.current = false;
      setIsGoogleLoading(false);
    }
  }, [signInWithGoogle, goAfterSignIn, isUserCancel, setError]);

  const handleAppleLogin = useCallback(async () => {
    setIsAppleLoading(true);
    setError('');
    localSignInRef.current = true;
    try {
      // #159: false = he closed the Apple sheet (or it came back empty).
      // No session exists, so no success haptic, no USER_LOGGED_IN, no
      // navigation — he stays on this screen.
      const signedIn = await signInWithApple();
      if (!signedIn) return;
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      track(AnalyticsEvents.USER_LOGGED_IN, { method: 'apple' });
      goAfterSignIn();
    } catch (err) {
      console.log('[Login] Apple login failed:', err);
      if (isUserCancel(err)) return;
      setError("Couldn't sign in with Apple. Please try again.");
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      localSignInRef.current = false;
      setIsAppleLoading(false);
    }
  }, [signInWithApple, goAfterSignIn, isUserCancel, setError]);

  // Magic link handler — sends a one-tap login link to the user's
  // email. They tap the link from their inbox, the app's deep-link
  // handler in _layout.tsx redeems the tokens, and they're in. No
  // password to type, no SMS cost.
  const handleMagicLink = useCallback(async () => {
    setError('');
    if (!email.trim()) {
      setEmailDanger(true);
      setError('Enter your email address first.');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setEmailDanger(true);
      setError('That email address looks off — please double-check it.');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setIsMagicLinkLoading(true);
    try {
      await sendMagicLink(email);
      layoutNext();
      setMagicLinkSent(true);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      track(AnalyticsEvents.USER_LOGGED_IN, { method: 'magic_link_requested' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send link. Try again.';
      setError(msg);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsMagicLinkLoading(false);
    }
  }, [email, sendMagicLink, setError]);

  return (
    <View style={styles.container}>
      <View style={[styles.topSection, { paddingTop: insets.top + 36 }]}>
        {/* Decorative amber glow only. The four hairline "concrete grid" rules
            that used to sit behind this hero were the same faint-rules-behind-
            content artifact removed from components/EmptyState.tsx — on device
            they read as a chart grid bleeding through, not as texture. Do not
            reintroduce; scripts/validate-visual-regressions.ts pins this. */}
        <View pointerEvents="none" style={styles.heroGlow} />

        <View style={styles.brandRow}>
          <Slot style={entrance.slot(0)}>
            <View style={styles.logoChip}>
              <HardHat size={16} color={Colors.orange} strokeWidth={2} />
            </View>
          </Slot>
          <Text
            ref={launchTarget.ref}
            {...launchTarget.layoutProps}
            style={entrance.showWordmark ? styles.brandWordmark : [styles.brandWordmark, HIDDEN]}
          >MAGE ID</Text>
        </View>

        <Slot style={entrance.slot(1)}>
          <Text style={styles.heroEyebrow}>WELCOME BACK</Text>
        </Slot>
        <Slot style={entrance.slot(2)}>
          <Text style={styles.heroLine}>
            Build it. <Text style={styles.heroLineAccent}>Bill it.</Text>
          </Text>
        </Slot>
        <Slot style={entrance.slot(3)}>
          <Text style={styles.heroLine}>
            Track every dollar.
          </Text>
        </Slot>
        <Slot style={entrance.slot(4)}>
          <Text style={styles.heroSub}>
            The operating system for general contractors.
          </Text>
        </Slot>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.formWrapper}
      >
        <ScrollView
          contentContainerStyle={[styles.formContainer, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View>
            {errorMessage ? (
              <Slot style={bannerFade}>
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>{errorMessage}</Text>
                </View>
              </Slot>
            ) : null}
            {elsewhereNotice ? (
              <View style={styles.noticeBanner} testID="login-invite-opened-elsewhere">
                <Text style={styles.noticeBannerText}>{elsewhereNotice}</Text>
              </View>
            ) : null}
          </View>

          {/* ─── Primary auth row (Apple / Google) ─────────────────
              Apple is iOS native — no Supabase URL prompt, no browser
              redirect, just the system Face ID sheet. Google goes
              through the standard OAuth flow. Both at the top because
              they're the lowest-friction paths. */}
          <Slot style={entrance.slot(5)}>
          <View style={styles.primaryAuthStack}>
            {Platform.OS === 'ios' || Platform.OS === 'web' ? (
              <TouchableOpacity
                style={[styles.primaryAuthButton, styles.appleAuthButton]}
                onPress={handleAppleLogin}
                disabled={isAppleLoading}
                activeOpacity={0.85}
                testID="login-apple"
              >
                {isAppleLoading ? (
                  <ActivityIndicator color={Colors.textOnAccent} size="small" />
                ) : (
                  <>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill={Colors.textOnAccent}>
                      <Path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </Svg>
                    <Text style={styles.appleAuthButtonText}>Continue with Apple</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.primaryAuthButton, styles.googleAuthButton]}
              onPress={handleGoogleLogin}
              disabled={isGoogleLoading}
              activeOpacity={0.85}
              testID="login-google"
            >
              {isGoogleLoading ? (
                <ActivityIndicator color={themeColors.text} size="small" />
              ) : (
                <>
                  <Svg width={20} height={20} viewBox="0 0 48 48">
                    <Path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#FFC107" />
                    <Path d="M5.3 14.7l7.4 5.4C14.3 16.3 18.8 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 6.1 29.6 4 24 4 16 4 9.2 8.4 5.3 14.7z" fill="#FF3D00" />
                    <Path d="M24 44c5.2 0 10-1.8 13.7-4.9l-6.7-5.5C28.9 35.5 26.6 36.5 24 36.5c-6 0-11.1-4-12.8-9.5l-7.3 5.6C7.8 38.9 15.4 44 24 44z" fill="#4CAF50" />
                    <Path d="M44.5 20H24v8.5h11.8c-1 3-3 5.5-5.8 7.1l6.7 5.5C40.6 37.5 46 31.4 46 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2" />
                  </Svg>
                  <Text style={styles.googleAuthButtonText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          </Slot>

          {/* ─── Magic link path ───────────────────────────────────
              Type email → tap "Email me a sign-in link" → Resend
              delivers a one-tap login. No password, no SMS cost. */}
          <Slot style={entrance.slot(6)}>
          <View style={styles.magicLinkStack}>
            <View style={styles.inputWrapper}>
              <Mail size={18} color={themeColors.textSecondary} strokeWidth={1.8} />
              <TextInput
                style={styles.input}
                placeholder="you@company.com"
                placeholderTextColor={themeColors.textMuted}
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (emailDanger) setEmailDanger(false);
                  if (magicLinkSent) {
                    layoutNext();
                    setMagicLinkSent(false);
                  }
                }}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType={showPasswordMode ? 'next' : 'go'}
                selectionColor={themeColors.accent}
                onSubmitEditing={() => showPasswordMode ? passwordRef.current?.focus() : handleMagicLink()}
                testID="login-email"
              />
              <FieldRing visible={emailFocused || emailDanger} tone={emailDanger ? 'danger' : 'accent'} radius={Tokens.radius.lg} />
            </View>
            <Slot style={magicSwap}>
            {magicLinkSent ? (
              <View style={[styles.magicLinkSuccess, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                <CheckCircle2 size={15} color={Colors.successDark} strokeWidth={2} />
                <Text style={[styles.magicLinkSuccessText, { flex: 1 }]}>
                  Check your inbox — we just sent a sign-in link to {email.trim()}.
                </Text>
              </View>
            ) : (
              <AuthSubmitButton
                phase={isMagicLinkLoading ? 'loading' : 'idle'}
                label="Email me a sign-in link"
                leading={<KeyRound size={18} color={themeColors.accent} strokeWidth={2} />}
                style={[styles.magicLinkButton, isMagicLinkLoading && styles.loginButtonDisabled]}
                textStyle={styles.magicLinkButtonText}
                spinnerColor={themeColors.accent}
                onPress={handleMagicLink}
                disabled={isMagicLinkLoading}
                activeOpacity={0.85}
                testID="login-magic-link"
              />
            )}
            </Slot>
          </View>
          </Slot>

          <Slot style={entrance.slot(7)}>
          {/* ─── Biometric (returning users) ──────────────────────── */}
          {biometricsAvailable && hasStoredCredentials && (
            <TouchableOpacity
              style={styles.biometricButton}
              onPress={handleBiometricLogin}
              activeOpacity={0.7}
              disabled={isBiometricLoading}
              testID="login-biometric"
            >
              {isBiometricLoading ? (
                <ActivityIndicator color={themeColors.accent} size="small" />
              ) : (
                <>
                  <ScanFace size={20} color={themeColors.accent} strokeWidth={1.8} />
                  <Text style={styles.biometricText}>
                    Sign in with Face ID / Touch ID
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* ─── Password fallback (collapsed) ─────────────────────
              Email/password is still here for users who prefer it,
              but it's the secondary path now. Tap to expand. */}
          {!showPasswordMode ? (
            <TouchableOpacity
              style={styles.passwordModeToggle}
              onPress={openPasswordMode}
              testID="login-show-password-mode"
            >
              <Text style={styles.passwordModeToggleText}>Sign in with password instead</Text>
            </TouchableOpacity>
          ) : (
            <Slot style={passwordReveal ? passwordReveal.style : null}>
            <View>
              <View style={[styles.inputGroup, { marginTop: 12 }]}>
                <Text style={styles.inputLabel}>Password</Text>
                <View style={styles.inputWrapper}>
                  <Lock size={18} color={themeColors.textSecondary} strokeWidth={1.8} />
                  <TextInput
                    ref={passwordRef}
                    style={styles.input}
                    placeholder="Enter password"
                    placeholderTextColor={themeColors.textMuted}
                    value={password}
                    onChangeText={(v) => {
                      setPassword(v);
                      if (passwordDanger) setPasswordDanger(false);
                    }}
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    secureTextEntry={!showPassword}
                    returnKeyType="go"
                    selectionColor={themeColors.accent}
                    onSubmitEditing={handleLogin}
                    testID="login-password"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    {showPassword ? (
                      <EyeOff size={18} color={themeColors.textSecondary} strokeWidth={1.8} />
                    ) : (
                      <Eye size={18} color={themeColors.textSecondary} strokeWidth={1.8} />
                    )}
                  </TouchableOpacity>
                  <FieldRing visible={passwordFocused || passwordDanger} tone={passwordDanger ? 'danger' : 'accent'} radius={Tokens.radius.lg} />
                </View>
              </View>
              <View style={styles.rememberRow}>
                <Text style={styles.rememberLabel}>Remember me</Text>
                <Switch
                  value={rememberMe}
                  onValueChange={setRememberMe}
                  trackColor={{ false: themeColors.line, true: themeColors.accent + '60' }}
                  thumbColor={rememberMe ? themeColors.accent : themeColors.textMuted}
                  testID="login-remember"
                />
              </View>
              <Animated.View style={press.style}>
                <AuthSubmitButton
                  phase={submitPhase}
                  label="Sign In"
                  trailing={<ArrowRight size={18} color={Colors.textOnAccent} strokeWidth={2.5} />}
                  style={[styles.loginButton, isSubmitting && styles.loginButtonDisabled]}
                  textStyle={styles.loginButtonText}
                  spinnerColor={Colors.textOnAccent}
                  onPress={handleLogin}
                  onPressIn={press.onPressIn}
                  onPressOut={press.onPressOut}
                  disabled={isSubmitting || signedIn}
                  activeOpacity={0.85}
                  testID="login-submit"
                />
              </Animated.View>
            </View>
            </Slot>
          )}

          </Slot>

          {/* Guest sign-in removed — we require real accounts (Google / Apple / email)
              so project data persists across devices and the MAU count only reflects
              real users, not anonymous throwaway rows. */}

          <Slot style={entrance.slot(8)}>
          <TouchableOpacity
            style={styles.forgotButton}
            onPress={async () => {
              if (!email.trim()) {
                showAlert('Enter Email', 'Please enter your email address first, then tap Forgot Password.');
                return;
              }
              if (!EMAIL_REGEX.test(email.trim())) {
                showAlert('Check Your Email', 'That email address looks off — please double-check it.');
                return;
              }
              try {
                await resetPassword(email.trim());
                showAlert('Check Your Email', 'A password reset link has been sent to ' + email.trim());
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to send reset email';
                showAlert('Error', msg);
              }
            }}
            testID="login-forgot"
          >
            <KeyRound size={14} color={themeColors.accent} strokeWidth={1.8} />
            <Text style={styles.forgotText}>Forgot Password?</Text>
          </TouchableOpacity>

          <View style={styles.signupRow}>
            <Text style={styles.signupPrompt}>Don't have an account?</Text>
            <TouchableOpacity
              onPress={() => router.push(signupHrefForInvite(inviteToken) as never)}
              testID="login-go-signup"
            >
              <Text style={styles.signupLink}>Create Account</Text>
            </TouchableOpacity>
          </View>
          </Slot>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  // Premium dark hero — matches the marketing site at https://mageid.app
  // Palette: --ink #0B0D10 + --amber #FF6A1A + --cream #F4EFE6.
  // A single soft amber glow gives the "industrial concrete × tech" feel
  // without an image asset — and without ruled lines behind the copy.
  topSection: {
    backgroundColor: '#0B0D10',
    paddingHorizontal: 28,
    paddingBottom: 40,
    alignItems: 'flex-start' as const,
    overflow: 'hidden' as const,
  },
  heroGlow: {
    position: 'absolute' as const,
    top: -100,
    right: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(255,106,26,0.18)',
  },
  brandRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 32,
    zIndex: 1,
  },
  logoChip: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.sm,
    backgroundColor: 'rgba(255,106,26,0.12)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: 'rgba(255,106,26,0.24)',
  },
  brandWordmark: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '800' as const,
    color: '#F4EFE6',
    letterSpacing: 2,
  },
  heroEyebrow: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.orange,
    letterSpacing: 2.5,
    marginBottom: 12,
    zIndex: 1,
  },
  heroLine: {
    fontSize: 36,
    fontWeight: '700' as const,
    color: '#F4EFE6',
    letterSpacing: -1,
    lineHeight: 42,
    fontStyle: Platform.OS === 'ios' ? 'normal' : 'normal',
    zIndex: 1,
  },
  heroLineAccent: {
    color: Colors.orange,
    fontStyle: 'italic' as const,
    fontWeight: '700' as const,
  },
  heroSub: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '500' as const,
    // Was the literal '#9AA3AD' — the DARK theme's textSecondary — sitting on
    // `t.bg`, which is near-white in light mode. 2.55:1 on a 13pt line, on the
    // FIRST screen anyone sees. neutralInk picks the same grey family by the
    // background's luminance, so it clears AA in both themes and keeps the
    // colour the design intended in dark (audit 2026-09-07, worth-doing #4).
    color: neutralInk(t),
    letterSpacing: 0.2,
    marginTop: 14,
    zIndex: 1,
  },
  formWrapper: {
    flex: 1,
  },
  formContainer: {
    padding: 24,
    paddingTop: 32,
    // Auth form: a cap is correct. No-op on phone (< 480 content width), stops
    // the inputs stretching edge-to-edge across a desktop browser.
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center' as const,
  },
  errorBanner: {
    backgroundColor: Colors.errorLight,
    borderRadius: Tokens.radius.card,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.15)',
  },
  errorBannerText: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.danger,
    fontWeight: '500' as const,
    textAlign: 'center',
  },
  noticeBanner: {
    ...cardSurface(t, { radius: 'card', pad: 14 }),
    marginBottom: 20,
  },
  noticeBannerText: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    fontWeight: '500' as const,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
    marginBottom: 8,
    marginLeft: 2,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: t.line,
  },
  input: {
    flex: 1,
    fontSize: Type.callout.fontSize,
    color: t.text,
    fontWeight: '400' as const,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  rememberLabel: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.textSecondary,
    fontWeight: '500' as const,
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0D10',
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    gap: 8,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 3,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  // Colors.textOnAccent, NOT t.surface. This sits on a FIXED fill (ink #0B0D10 /
  // Apple black / t.accentFill) that does not change with the theme, so the
  // foreground must not either. In dark mode t.surface is #14181D: the Sign In
  // label was 1.09:1 on its own button, and the page behind it is #0B0D10 too,
  // so the button had no edge and the label no contrast. validate-contrast.ts
  // passes on this file — it prints an explicit allowance for it.
  loginButtonText: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnAccent,
  },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1.5,
    borderColor: t.accent,
    backgroundColor: t.surface,
    marginTop: 12,
  },
  biometricText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.accent,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 16,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: t.line,
  },
  dividerText: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    fontWeight: '500' as const,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 12,
  },
  primaryAuthStack: {
    gap: 10,
    marginTop: 4,
    marginBottom: 16,
  },
  primaryAuthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1.5,
  },
  appleAuthButton: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  appleAuthButtonText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnAccent,
  },
  googleAuthButton: {
    backgroundColor: t.surface,
    borderColor: t.line,
  },
  googleAuthButtonText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  magicLinkStack: {
    gap: 10,
    marginBottom: 16,
  },
  magicLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.accent + '0F',
    borderWidth: 1,
    borderColor: t.accent + '40',
  },
  magicLinkButtonText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: t.accent,
  },
  magicLinkSuccess: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: Tokens.radius.card,
    backgroundColor: '#1E8E4A' + '12',
    borderWidth: 1,
    borderColor: '#1E8E4A' + '40',
  },
  magicLinkSuccessText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.successDark,
    lineHeight: 19,
  },
  passwordModeToggle: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  passwordModeToggleText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
    textDecorationLine: 'underline',
  },
  socialButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1.5,
    borderColor: t.line,
    backgroundColor: t.surface,
  },
  socialButtonText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  appleSocialButton: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  appleSocialButtonText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: Colors.textOnAccent,
  },
  signupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
  },
  signupPrompt: {
    fontSize: Type.subhead.fontSize,
    color: t.textSecondary,
  },
  signupLink: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: '#0B0D10',
  },
  forgotButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    marginTop: 16,
    paddingVertical: 8,
  },
  forgotText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.orange,
  },
});
