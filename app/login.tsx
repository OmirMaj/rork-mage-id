import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Animated, ActivityIndicator, Switch,
  Easing, useWindowDimensions, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Mail, Lock, Eye, EyeOff, ArrowRight, ScanFace, KeyRound, Chrome, CheckCircle2 } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { track, AnalyticsEvents } from '@/utils/analytics';
import { Type, DISPLAY_FONT } from '@/constants/typography';
import { cardSurface } from '@/components/ui';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { AuthGround, MonogramMark, SamplePill, SpineHeadline, NIGHT } from '@/components/auth/AuthGround';
import MiniSpine from '@/components/auth/MiniSpine';
import SpineHero from '@/components/auth/SpineHero';
import { Motion, Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { classifyError, describeError, rawErrorMessage, readerSentence } from '@/utils/errorCopy';
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

/** The sign-in failure as a sentence. The two answers a person can act on
 *  (wrong password, unconfirmed email) are named; everything else goes
 *  through describeError so no raw auth text reaches the screen. */
function signInErrorText(err: unknown): string {
  const raw = rawErrorMessage(err);
  if (/invalid login credentials/i.test(raw)) {
    return "That email and password don't match. Check them, or email yourself a sign-in link.";
  }
  if (/email not confirmed/i.test(raw)) {
    return 'Confirm your email first. Open the link we sent to your inbox.';
  }
  return describeError(err, { action: 'sign you in' }).body;
}


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
  // The spine ("Take D"): phone = a mini spine over the sign-in sheet; desktop
  // web = the full spine on a night panel, the form on the right.
  const isDeskWeb = useIsDesktopWeb();
  const { width: winW, height: winH } = useWindowDimensions();
  const miniWidth = Math.min(winW, 390 * Math.min(1, Math.max(0.7, (winH - 560) / 212)));
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
        'Sign In with Your Password First',
        'Sign in with your email and password with "Remember Me" on. After that, you can use Face ID or Touch ID.'
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
      console.warn('[Login] biometric sign-in failed:', rawErrorMessage(err));
      showAlert("Couldn't Sign In", 'Face ID or Touch ID did not confirm. Sign in with your password instead.');
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
      setError('Fill in every field.');
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
      console.warn('[Login] sign-in failed:', rawErrorMessage(err));
      setError(signInErrorText(err));
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
      setError("Couldn't sign in with Google. Try again.");
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
      setError("Couldn't sign in with Apple. Try again.");
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
      setError('That email address looks off. Check it and try again.');
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
      // The auth-magic-link function answers in sentences written for the
      // reader (rate limit, bad address; AuthContext passes them through).
      // Only text that reads as such a sentence is shown (readerSentence);
      // a transport failure or a terse server note gets describeError copy.
      console.warn('[Login] sign-in link failed:', rawErrorMessage(err));
      setError((classifyError(err) === 'unknown' ? readerSentence(rawErrorMessage(err)) : null)
        ?? describeError(err, { action: 'send the sign-in link' }).body);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsMagicLinkLoading(false);
    }
  }, [email, sendMagicLink, setError]);

  return (
    <View style={[styles.container, isDeskWeb && styles.containerDesk]}>
      {/* The night hero: the monogram (no hard-hat mark), the "Sample project"
          pill, and the spine. Decorative only; every control is in the sheet.
          No concrete-grid hairlines behind it (validate-visual-regressions). */}
      <View style={isDeskWeb ? styles.deskLeft : [styles.topSection, { paddingTop: insets.top + 16 }]}>
        <AuthGround />
        <View style={[styles.brandRow, isDeskWeb && styles.brandRowDesk]}>
          <Slot style={entrance.slot(0)}>
            <MonogramMark height={isDeskWeb ? 48 : 40} />
          </Slot>
          <Text
            ref={launchTarget.ref}
            {...launchTarget.layoutProps}
            style={entrance.showWordmark ? styles.brandWordmark : [styles.brandWordmark, HIDDEN]}
          >MAGE ID</Text>
          <View style={styles.brandSpacer} />
          <Slot style={entrance.slot(1)}>
            <SamplePill />
          </Slot>
        </View>

        <Slot style={entrance.slot(2)}>
          {isDeskWeb ? (
            <View style={styles.deskSpine}>
              <SpineHero width={Math.max(320, winW - 556 - 96)} height={Math.max(300, winH - 330)} maxScale={1.04} testID="login-spine" />
            </View>
          ) : (
            <MiniSpine width={miniWidth} style={styles.miniSpine} testID="login-mini-spine" />
          )}
        </Slot>
        {isDeskWeb ? <SpineHeadline size={40} style={styles.deskCopy} lede={styles.deskLede} /> : null}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={isDeskWeb ? styles.deskRight : styles.formWrapper}
      >
        <ScrollView
          contentContainerStyle={[styles.formContainer, { paddingBottom: insets.bottom + 24 }, isDeskWeb && styles.formDesk]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Slot style={entrance.slot(3)}>
            <Text style={styles.sheetEyebrow}>Welcome Back</Text>
          </Slot>
          <Slot style={entrance.slot(4)}>
            <Text style={styles.sheetHeading} accessibilityRole="header">{isDeskWeb ? 'Sign In to MAGE ID' : 'Sign In'}</Text>
          </Slot>
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
                  Check your inbox. We sent a sign-in link to {email.trim()}.
                </Text>
              </View>
            ) : (
              <AuthSubmitButton
                phase={isMagicLinkLoading ? 'loading' : 'idle'}
                label="Email Me a Sign-In Link"
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
                    Sign In with Face ID or Touch ID
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
              <Text style={styles.passwordModeToggleText}>Sign In with Password Instead</Text>
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
                <Text style={styles.rememberLabel}>Remember Me</Text>
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
                showAlert('Add Your Email', 'Enter your email address, then tap Forgot password.');
                return;
              }
              if (!EMAIL_REGEX.test(email.trim())) {
                showAlert('Check Your Email Address', 'That email address looks off. Check it and try again.');
                return;
              }
              try {
                await resetPassword(email.trim());
                showAlert('Check Your Email', 'A password reset link was sent to ' + email.trim() + '.');
              } catch (err: unknown) {
                console.warn('[Login] reset email failed:', rawErrorMessage(err));
                const copy = describeError(err, { action: 'send the password reset email' });
                showAlert(copy.title, copy.body);
              }
            }}
            testID="login-forgot"
          >
            <KeyRound size={14} color={themeColors.accent} strokeWidth={1.8} />
            <Text style={styles.forgotText}>Forgot password?</Text>
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
  // The night ground (components/auth/AuthGround) shows behind the sheet's
  // rounded top corners, so the screen itself is night, not t.bg.
  container: {
    flex: 1,
    backgroundColor: NIGHT.mid,
  },
  containerDesk: {
    flexDirection: 'row' as const,
  },
  // The hero: the same night field in both themes. Its type is light-on-night.
  topSection: {
    backgroundColor: '#151816',
    paddingHorizontal: 22,
    paddingBottom: 40,
    overflow: 'hidden' as const,
  },
  brandRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginBottom: 18,
    zIndex: 1,
  },
  brandRowDesk: {
    marginBottom: 0,
  },
  brandSpacer: {
    flex: 1,
  },
  // Kept for the splash hand-off: BrandSplash's "MAGE ID" lands on this word.
  brandWordmark: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '800' as const,
    color: '#F4EFE6',
    letterSpacing: 2,
  },
  miniSpine: {
    alignSelf: 'center' as const,
  },
  // Desktop web: the spine on a night panel on the left, the form on the right.
  deskLeft: {
    flex: 1,
    paddingHorizontal: 48,
    paddingTop: 44,
    paddingBottom: 52,
    overflow: 'hidden' as const,
    justifyContent: 'space-between' as const,
  },
  deskSpine: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 20,
  },
  deskCopy: {
    maxWidth: 628,
  },
  deskLede: {
    fontSize: 16,
  },
  deskRight: {
    width: 556,
    backgroundColor: t.bg,
  },
  formDesk: {
    flexGrow: 1,
    justifyContent: 'center' as const,
    maxWidth: 372,
    paddingTop: 48,
  },
  // The sheet: the light (themed) page rising over the night hero.
  formWrapper: {
    flex: 1,
    marginTop: -24,
    backgroundColor: t.bg,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden' as const,
  },
  formContainer: {
    padding: 24,
    paddingTop: 26,
    // Auth form: a cap is correct. No-op on phone (< 480 content width), stops
    // the inputs stretching edge-to-edge across a desktop browser.
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center' as const,
  },
  sheetEyebrow: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: t.accentLabel,
    letterSpacing: 1.8,
    textTransform: 'uppercase' as const,
  },
  sheetHeading: {
    fontFamily: DISPLAY_FONT.bold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.5,
    color: t.text,
    marginTop: 6,
    marginBottom: 18,
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
    // #151816, the dark ground since the 2026-09-16 rebrand (was #0B0D10). It
    // also has to MATCH Theme.dark.bg: scripts/validate-contrast.ts check 13
    // recognises this file as painting a real ink field by comparing against
    // that token, and prints its exemption on that basis.
    backgroundColor: '#151816',
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
  // Colors.textOnAccent, NOT t.surface. This sits on a FIXED fill (ink #151816 /
  // Apple black / t.accentFill) that does not change with the theme, so the
  // foreground must not either. In dark mode t.surface is the dark surface: the
  // Sign In label was 1.09:1 on its own button, and the page behind it is ink too,
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
    backgroundColor: '#12806E' + '12',
    borderWidth: 1,
    borderColor: '#12806E' + '40',
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
    // t.accentLabel, not ink. The literal '#0B0D10' was ink TEXT on t.bg — fine
    // on the light ground and roughly 1.1:1 on the dark one, so "Sign up" simply
    // vanished in dark mode. The theme-aware brand label clears AA in both, and
    // a link reads as a link in the brand colour.
    color: t.accentLabel,
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
    // A brand text link on the themed page: accentLabel is the AA ink in both
    // themes. (This was Colors.orange — the system WARNING orange, not brand.)
    color: t.accentLabel,
  },
});
