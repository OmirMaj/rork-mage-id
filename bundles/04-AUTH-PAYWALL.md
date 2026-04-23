# Auth, Onboarding, Subscription Paywall


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

Everything on the pre-authenticated path plus the RevenueCat paywall.

- `app/login.tsx`, `app/signup.tsx`, `app/reset-password.tsx` — Supabase
  email/password and SSO flows.
- `app/onboarding.tsx`, `app/onboarding-paywall.tsx` — first-run experience
  with the RevenueCat paywall immediately after.
- `app/paywall.tsx` + `components/Paywall.tsx` — in-app upgrade sheet.
- `hooks/useTierAccess.ts` — the single gate. Never branch on raw RevenueCat
  entitlements from feature code.


## Files in this bundle

- `app/login.tsx`
- `app/signup.tsx`
- `app/reset-password.tsx`
- `app/onboarding.tsx`
- `app/onboarding-paywall.tsx`
- `app/paywall.tsx`
- `components/Paywall.tsx`


---

### `app/login.tsx`

```tsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { HardHat, Mail, Lock, Eye, EyeOff, ArrowRight, ScanFace, KeyRound, Chrome } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { track, AnalyticsEvents } from '@/utils/analytics';

let _LocalAuthentication: typeof import('expo-local-authentication') | null = null;

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login, loginWithBiometrics, resetPassword, hasStoredCredentials, signInWithGoogle, signInWithApple } = useAuth();

  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isAppleLoading, setIsAppleLoading] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  const buttonScale = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const passwordRef = useRef<TextInput>(null);

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

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const handleBiometricLogin = useCallback(async () => {
    if (!hasStoredCredentials) {
      Alert.alert(
        'No Stored Credentials',
        'Please log in with your email and password first. After a successful login with "Remember me" enabled, you can use biometrics next time.'
      );
      return;
    }

    setIsBiometricLoading(true);
    try {
      await loginWithBiometrics();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      track(AnalyticsEvents.USER_LOGGED_IN, { method: 'biometric' });
      router.replace('/(tabs)/(home)');
    } catch (err) {
      console.log('[Login] Biometric auth failed:', err);
      const msg = err instanceof Error ? err.message : 'Biometric authentication failed.';
      Alert.alert('Authentication Failed', msg);
    } finally {
      setIsBiometricLoading(false);
    }
  }, [hasStoredCredentials, loginWithBiometrics, router]);

  const handleLogin = useCallback(async () => {
    setErrorMessage('');

    if (!email.trim() || !password.trim()) {
      setErrorMessage('Please fill in all fields');
      shake();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }

    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(buttonScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();

    setIsSubmitting(true);

    try {
      await login(email.trim(), password, rememberMe);
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      track(AnalyticsEvents.USER_LOGGED_IN, { method: 'email' });
      router.replace('/(tabs)/(home)');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setErrorMessage(message);
      shake();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, rememberMe, login, router, buttonScale, shake]);

  const handleGoogleLogin = useCallback(async () => {
    setIsGoogleLoading(true);
    setErrorMessage('');
    try {
      await signInWithGoogle();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      track(AnalyticsEvents.USER_LOGGED_IN, { method: 'google' });
      router.replace('/(tabs)/(home)');
    } catch (err) {
      console.log('[Login] Google login failed:', err);
    } finally {
      setIsGoogleLoading(false);
    }
  }, [signInWithGoogle, router]);

  const handleAppleLogin = useCallback(async () => {
    setIsAppleLoading(true);
    setErrorMessage('');
    try {
      await signInWithApple();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      track(AnalyticsEvents.USER_LOGGED_IN, { method: 'apple' });
      router.replace('/(tabs)/(home)');
    } catch (err) {
      console.log('[Login] Apple login failed:', err);
    } finally {
      setIsAppleLoading(false);
    }
  }, [signInWithApple, router]);

  return (
    <View style={styles.container}>
      <View style={[styles.topSection, { paddingTop: insets.top + 40 }]}>
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <HardHat size={36} color="#FFFFFF" strokeWidth={1.8} />
          </View>
        </View>
        <Text style={styles.brandName}>MAGE ID</Text>
        <Text style={styles.brandTagline}>Welcome back</Text>
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
          <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
            {errorMessage ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <View style={styles.inputWrapper}>
                <Mail size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                <TextInput
                  style={styles.input}
                  placeholder="you@company.com"
                  placeholderTextColor={Colors.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  selectionColor={Colors.primary}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  testID="login-email"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.inputWrapper}>
                <Lock size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                <TextInput
                  ref={passwordRef}
                  style={styles.input}
                  placeholder="Enter password"
                  placeholderTextColor={Colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="go"
                  selectionColor={Colors.primary}
                  onSubmitEditing={handleLogin}
                  testID="login-password"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  {showPassword ? (
                    <EyeOff size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                  ) : (
                    <Eye size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.rememberRow}>
              <Text style={styles.rememberLabel}>Remember me</Text>
              <Switch
                value={rememberMe}
                onValueChange={setRememberMe}
                trackColor={{ false: Colors.borderLight, true: Colors.primary + '60' }}
                thumbColor={rememberMe ? Colors.primary : Colors.textMuted}
                testID="login-remember"
              />
            </View>
          </Animated.View>

          <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
            <TouchableOpacity
              style={[styles.loginButton, isSubmitting && styles.loginButtonDisabled]}
              onPress={handleLogin}
              disabled={isSubmitting}
              activeOpacity={0.85}
              testID="login-submit"
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Text style={styles.loginButtonText}>Sign In</Text>
                  <ArrowRight size={18} color="#FFFFFF" strokeWidth={2.5} />
                </>
              )}
            </TouchableOpacity>
          </Animated.View>

          {biometricsAvailable && (
            <TouchableOpacity
              style={styles.biometricButton}
              onPress={handleBiometricLogin}
              activeOpacity={0.7}
              disabled={isBiometricLoading}
              testID="login-biometric"
            >
              {isBiometricLoading ? (
                <ActivityIndicator color={Colors.primary} size="small" />
              ) : (
                <>
                  <ScanFace size={20} color={Colors.primary} strokeWidth={1.8} />
                  <Text style={styles.biometricText}>
                    {hasStoredCredentials
                      ? 'Sign in with Face ID / Touch ID'
                      : 'Log in first to enable biometrics'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.socialRow}>
            <TouchableOpacity
              style={styles.socialButton}
              onPress={handleGoogleLogin}
              disabled={isGoogleLoading}
              activeOpacity={0.7}
              testID="login-google"
            >
              {isGoogleLoading ? (
                <ActivityIndicator color={Colors.text} size="small" />
              ) : (
                <>
                  <Svg width={20} height={20} viewBox="0 0 48 48">
                    <Path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#FFC107" />
                    <Path d="M5.3 14.7l7.4 5.4C14.3 16.3 18.8 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 6.1 29.6 4 24 4 16 4 9.2 8.4 5.3 14.7z" fill="#FF3D00" />
                    <Path d="M24 44c5.2 0 10-1.8 13.7-4.9l-6.7-5.5C28.9 35.5 26.6 36.5 24 36.5c-6 0-11.1-4-12.8-9.5l-7.3 5.6C7.8 38.9 15.4 44 24 44z" fill="#4CAF50" />
                    <Path d="M44.5 20H24v8.5h11.8c-1 3-3 5.5-5.8 7.1l6.7 5.5C40.6 37.5 46 31.4 46 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2" />
                  </Svg>
                  <Text style={styles.socialButtonText}>Google</Text>
                </>
              )}
            </TouchableOpacity>

            {Platform.OS === 'ios' || Platform.OS === 'web' ? (
              <TouchableOpacity
                style={[styles.socialButton, styles.appleSocialButton]}
                onPress={handleAppleLogin}
                disabled={isAppleLoading}
                activeOpacity={0.7}
                testID="login-apple"
              >
                {isAppleLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="#FFFFFF">
                      <Path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </Svg>
                    <Text style={styles.appleSocialButtonText}>Apple</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Guest sign-in removed — we require real accounts (Google / Apple / email)
              so project data persists across devices and the MAU count only reflects
              real users, not anonymous throwaway rows. */}

          <TouchableOpacity
            style={styles.forgotButton}
            onPress={async () => {
              if (!email.trim()) {
                Alert.alert('Enter Email', 'Please enter your email address first, then tap Forgot Password.');
                return;
              }
              try {
                await resetPassword(email.trim());
                Alert.alert('Check Your Email', 'A password reset link has been sent to ' + email.trim());
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to send reset email';
                Alert.alert('Error', msg);
              }
            }}
            testID="login-forgot"
          >
            <KeyRound size={14} color={Colors.primary} strokeWidth={1.8} />
            <Text style={styles.forgotText}>Forgot Password?</Text>
          </TouchableOpacity>

          <View style={styles.signupRow}>
            <Text style={styles.signupPrompt}>Don't have an account?</Text>
            <TouchableOpacity
              onPress={() => router.push('/signup' as never)}
              testID="login-go-signup"
            >
              <Text style={styles.signupLink}>Create Account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  topSection: {
    backgroundColor: Colors.primary,
    paddingBottom: 40,
    alignItems: 'center',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  logoContainer: {
    marginBottom: 16,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  brandName: {
    fontSize: 30,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  brandTagline: {
    fontSize: 16,
    fontWeight: '500' as const,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  formWrapper: {
    flex: 1,
  },
  formContainer: {
    padding: 24,
    paddingTop: 32,
  },
  errorBanner: {
    backgroundColor: Colors.errorLight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.15)',
  },
  errorBannerText: {
    fontSize: 14,
    color: Colors.error,
    fontWeight: '500' as const,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 8,
    marginLeft: 2,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
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
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
    marginTop: 8,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
    marginTop: 12,
  },
  biometricText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
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
    backgroundColor: Colors.borderLight,
  },
  dividerText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 12,
  },
  socialButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  socialButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  appleSocialButton: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  appleSocialButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  signupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
  },
  signupPrompt: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  signupLink: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
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
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.primary,
  },
});

```


---

### `app/signup.tsx`

```tsx
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { HardHat, Mail, Lock, Eye, EyeOff, User, ArrowRight, ChevronLeft } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signup, signInWithGoogle, signInWithApple } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isAppleLoading, setIsAppleLoading] = useState(false);

  const buttonScale = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const handleGoogleSignup = useCallback(async () => {
    setIsGoogleLoading(true);
    setErrorMessage('');
    try {
      await signInWithGoogle();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.replace('/onboarding');
    } catch (err) {
      console.log('[Signup] Google signup failed:', err);
    } finally {
      setIsGoogleLoading(false);
    }
  }, [signInWithGoogle, router]);

  const handleAppleSignup = useCallback(async () => {
    setIsAppleLoading(true);
    setErrorMessage('');
    try {
      await signInWithApple();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.replace('/onboarding');
    } catch (err) {
      console.log('[Signup] Apple signup failed:', err);
    } finally {
      setIsAppleLoading(false);
    }
  }, [signInWithApple, router]);

  const handleSignup = useCallback(async () => {
    setErrorMessage('');

    if (!name.trim() || !email.trim() || !password.trim() || !confirmPassword.trim()) {
      setErrorMessage('Please fill in all fields');
      shake();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters');
      shake();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match');
      shake();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }

    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(buttonScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();

    setIsSubmitting(true);

    try {
      await signup(email.trim(), password, name.trim());
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.replace('/onboarding');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Signup failed. Please try again.';
      setErrorMessage(message);
      shake();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [name, email, password, confirmPassword, signup, router, buttonScale, shake]);

  return (
    <View style={styles.container}>
      <View style={[styles.topSection, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ChevronLeft size={24} color="#FFFFFF" strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.logoRow}>
          <View style={styles.logoCircle}>
            <HardHat size={28} color="#FFFFFF" strokeWidth={1.8} />
          </View>
          <View>
            <Text style={styles.brandName}>MAGE ID</Text>
            <Text style={styles.brandTagline}>Create your account</Text>
          </View>
        </View>
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
          <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
            {errorMessage ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Full Name</Text>
              <View style={styles.inputWrapper}>
                <User size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                <TextInput
                  style={styles.input}
                  placeholder="John Doe"
                  placeholderTextColor={Colors.textMuted}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  testID="signup-name"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <View style={styles.inputWrapper}>
                <Mail size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                <TextInput
                  ref={emailRef}
                  style={styles.input}
                  placeholder="you@company.com"
                  placeholderTextColor={Colors.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  testID="signup-email"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.inputWrapper}>
                <Lock size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                <TextInput
                  ref={passwordRef}
                  style={styles.input}
                  placeholder="Min 6 characters"
                  placeholderTextColor={Colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                  testID="signup-password"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  {showPassword ? (
                    <EyeOff size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                  ) : (
                    <Eye size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Confirm Password</Text>
              <View style={styles.inputWrapper}>
                <Lock size={18} color={Colors.textSecondary} strokeWidth={1.8} />
                <TextInput
                  ref={confirmRef}
                  style={styles.input}
                  placeholder="Re-enter password"
                  placeholderTextColor={Colors.textMuted}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="go"
                  onSubmitEditing={handleSignup}
                  testID="signup-confirm"
                />
              </View>
            </View>
          </Animated.View>

          <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
            <TouchableOpacity
              style={[styles.signupButton, isSubmitting && styles.signupButtonDisabled]}
              onPress={handleSignup}
              disabled={isSubmitting}
              activeOpacity={0.85}
              testID="signup-submit"
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Text style={styles.signupButtonText}>Create Account</Text>
                  <ArrowRight size={18} color="#FFFFFF" strokeWidth={2.5} />
                </>
              )}
            </TouchableOpacity>
          </Animated.View>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or sign up with</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.socialRow}>
            <TouchableOpacity
              style={styles.socialButton}
              onPress={handleGoogleSignup}
              disabled={isGoogleLoading}
              activeOpacity={0.7}
              testID="signup-google"
            >
              {isGoogleLoading ? (
                <ActivityIndicator color={Colors.text} size="small" />
              ) : (
                <>
                  <Svg width={20} height={20} viewBox="0 0 48 48">
                    <Path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#FFC107" />
                    <Path d="M5.3 14.7l7.4 5.4C14.3 16.3 18.8 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 6.1 29.6 4 24 4 16 4 9.2 8.4 5.3 14.7z" fill="#FF3D00" />
                    <Path d="M24 44c5.2 0 10-1.8 13.7-4.9l-6.7-5.5C28.9 35.5 26.6 36.5 24 36.5c-6 0-11.1-4-12.8-9.5l-7.3 5.6C7.8 38.9 15.4 44 24 44z" fill="#4CAF50" />
                    <Path d="M44.5 20H24v8.5h11.8c-1 3-3 5.5-5.8 7.1l6.7 5.5C40.6 37.5 46 31.4 46 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2" />
                  </Svg>
                  <Text style={styles.socialButtonText}>Google</Text>
                </>
              )}
            </TouchableOpacity>

            {Platform.OS === 'ios' || Platform.OS === 'web' ? (
              <TouchableOpacity
                style={[styles.socialButton, styles.appleSocialButton]}
                onPress={handleAppleSignup}
                disabled={isAppleLoading}
                activeOpacity={0.7}
                testID="signup-apple"
              >
                {isAppleLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="#FFFFFF">
                      <Path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </Svg>
                    <Text style={styles.appleSocialButtonText}>Apple</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.loginRow}>
            <Text style={styles.loginPrompt}>Already have an account?</Text>
            <TouchableOpacity
              onPress={() => router.back()}
              testID="signup-go-login"
            >
              <Text style={styles.loginLink}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  topSection: {
    backgroundColor: Colors.primary,
    paddingBottom: 28,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logoCircle: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  brandName: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  brandTagline: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  formWrapper: {
    flex: 1,
  },
  formContainer: {
    padding: 24,
    paddingTop: 28,
  },
  errorBanner: {
    backgroundColor: Colors.errorLight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.15)',
  },
  errorBannerText: {
    fontSize: 14,
    color: Colors.error,
    fontWeight: '500' as const,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 18,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 8,
    marginLeft: 2,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
    fontWeight: '400' as const,
  },
  signupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
    marginTop: 8,
  },
  signupButtonDisabled: {
    opacity: 0.7,
  },
  signupButtonText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 28,
  },
  loginPrompt: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  loginLink: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
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
    backgroundColor: Colors.borderLight,
  },
  dividerText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 12,
  },
  socialButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  socialButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  appleSocialButton: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  appleSocialButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
});

```


---

### `app/reset-password.tsx`

```tsx
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { Lock, CheckCircle, ArrowRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { updatePassword } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    const accessToken = params.access_token as string | undefined;
    const refreshToken = params.refresh_token as string | undefined;

    if (accessToken) {
      console.log('[ResetPassword] Setting session from deep link');
      void supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken ?? '',
      }).then(({ error }) => {
        if (error) {
          console.log('[ResetPassword] Failed to set session:', error.message);
          Alert.alert('Error', 'Invalid or expired reset link. Please request a new one.');
        }
      });
    }
  }, [params.access_token, params.refresh_token]);

  const handleSubmit = useCallback(async () => {
    if (!newPassword.trim() || newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await updatePassword(newPassword);
      setIsSuccess(true);
      setTimeout(() => {
        router.replace('/login');
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update password.';
      Alert.alert('Error', msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [newPassword, confirmPassword, updatePassword, router]);

  if (isSuccess) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 60 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <CheckCircle size={48} color={Colors.success} strokeWidth={1.5} />
          </View>
          <Text style={styles.successTitle}>Password Updated</Text>
          <Text style={styles.successText}>
            Your password has been successfully reset. Redirecting to login...
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <View style={[styles.content, { paddingTop: insets.top + 60 }]}>
          <View style={styles.iconWrap}>
            <Lock size={32} color={Colors.primary} strokeWidth={1.5} />
          </View>
          <Text style={styles.title}>Set New Password</Text>
          <Text style={styles.subtitle}>
            Enter your new password below.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>New Password</Text>
            <View style={styles.inputWrapper}>
              <Lock size={18} color={Colors.textSecondary} strokeWidth={1.8} />
              <TextInput
                style={styles.input}
                placeholder="Minimum 6 characters"
                placeholderTextColor={Colors.textMuted}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoCapitalize="none"
                selectionColor={Colors.primary}
                testID="reset-new-password"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Confirm Password</Text>
            <View style={styles.inputWrapper}>
              <Lock size={18} color={Colors.textSecondary} strokeWidth={1.8} />
              <TextInput
                style={styles.input}
                placeholder="Re-enter password"
                placeholderTextColor={Colors.textMuted}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoCapitalize="none"
                selectionColor={Colors.primary}
                onSubmitEditing={handleSubmit}
                testID="reset-confirm-password"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            activeOpacity={0.85}
            testID="reset-submit"
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Text style={styles.submitButtonText}>Update Password</Text>
                <ArrowRight size={18} color="#FFFFFF" strokeWidth={2.5} />
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.replace('/login')}
            testID="reset-back"
          >
            <Text style={styles.backText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  inner: {
    flex: 1,
  },
  content: {
    padding: 24,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    alignSelf: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 8,
    marginLeft: 2,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
    fontWeight: '400' as const,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  backButton: {
    alignSelf: 'center',
    paddingVertical: 16,
  },
  backText: {
    fontSize: 15,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  successContainer: {
    alignItems: 'center',
    padding: 24,
  },
  successIcon: {
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  successText: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});

```


---

### `app/onboarding.tsx`

```tsx
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
  Platform,
  FlatList,
  ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  HardHat,
  Calculator,
  CalendarDays,
  Package,
  Share2,
  Users,
  ArrowRight,
  CheckCircle,
  Sparkles,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface OnboardingSlide {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
  bgGradientTop: string;
  bgGradientBottom: string;
}

const SLIDES: OnboardingSlide[] = [
  {
    id: 'welcome',
    title: 'MAGE ID',
    subtitle: 'Your Construction Command Center',
    description: 'Estimate costs, build schedules, manage materials, and collaborate with your team — all in one powerful app.',
    icon: <HardHat size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#1A6B3C',
    bgGradientTop: '#1A6B3C',
    bgGradientBottom: '#0F4526',
  },
  {
    id: 'projects',
    title: 'Create Projects',
    subtitle: 'Organize Everything',
    description: 'Start by creating a project — name it, describe it, and choose the type. Everything from estimates to schedules lives inside your project.',
    icon: <Sparkles size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#FF9500',
    bgGradientTop: '#FF9500',
    bgGradientBottom: '#E08600',
  },
  {
    id: 'estimate',
    title: 'Smart Estimates',
    subtitle: 'Accurate Cost Breakdowns',
    description: 'Browse materials, add quantities, and get instant pricing with bulk savings. Link estimates directly to your projects for a complete picture.',
    icon: <Calculator size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#007AFF',
    bgGradientTop: '#007AFF',
    bgGradientBottom: '#0055CC',
  },
  {
    id: 'schedule',
    title: 'BW Schedule Maker',
    subtitle: 'Plan Like a Pro',
    description: 'Build timelines with tasks, milestones, critical path analysis, and work breakdown structures. Visualize your entire project on an interactive timeline.',
    icon: <CalendarDays size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#AF52DE',
    bgGradientTop: '#AF52DE',
    bgGradientBottom: '#8A2DB5',
  },
  {
    id: 'materials',
    title: 'Material Pricing',
    subtitle: 'Real Costs at Your Fingertips',
    description: 'Access a comprehensive material database with retail and bulk pricing. Compare suppliers and find savings across categories.',
    icon: <Package size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#FF3B30',
    bgGradientTop: '#FF3B30',
    bgGradientBottom: '#CC2F26',
  },
  {
    id: 'share',
    title: 'Share & Collaborate',
    subtitle: 'Work Together Seamlessly',
    description: 'Generate professional PDFs with your company logo and signature. Share via email or text, and invite team members to collaborate on projects.',
    icon: <Share2 size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#34C759',
    bgGradientTop: '#34C759',
    bgGradientBottom: '#28A745',
  },
  {
    id: 'settings',
    title: 'Make It Yours',
    subtitle: 'Company Branding & Settings',
    description: 'Upload your logo, draw your signature, and customize tax rates and contingency. Every PDF you generate will carry your professional brand.',
    icon: <Users size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#5856D6',
    bgGradientTop: '#5856D6',
    bgGradientBottom: '#4240AB',
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const iconAnim = useRef(new Animated.Value(0)).current;

  const startIconPulse = useCallback(() => {
    iconAnim.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(iconAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(iconAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [iconAnim]);

  React.useEffect(() => {
    startIconPulse();
  }, [startIconPulse]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setCurrentIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const isLastSlide = currentIndex === SLIDES.length - 1;

  const { completeOnboarding } = useProjects();

  const handleFinish = useCallback(() => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    void completeOnboarding();
    // Route through the onboarding paywall for first-time users. It will
    // self-route to /(tabs)/(home) on close or on successful purchase.
    router.replace('/onboarding-paywall' as never);
  }, [router, completeOnboarding]);

  const handleNext = useCallback(() => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.timing(buttonScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();

    if (isLastSlide) {
      handleFinish();
    } else {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
    }
  }, [currentIndex, isLastSlide, buttonScale, handleFinish]);

  const handleSkip = useCallback(() => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    void completeOnboarding();
    // Skipping the onboarding carousel still routes through the paywall;
    // the paywall itself is dismissable so users aren't trapped.
    router.replace('/onboarding-paywall' as never);
  }, [router, completeOnboarding]);

  const iconScale = iconAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  const renderSlide = useCallback(({ item, index }: { item: OnboardingSlide; index: number }) => {
    const inputRange = [
      (index - 1) * SCREEN_WIDTH,
      index * SCREEN_WIDTH,
      (index + 1) * SCREEN_WIDTH,
    ];

    const titleOpacity = scrollX.interpolate({
      inputRange,
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    });

    const titleTranslateY = scrollX.interpolate({
      inputRange,
      outputRange: [40, 0, -40],
      extrapolate: 'clamp',
    });

    const descOpacity = scrollX.interpolate({
      inputRange,
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    });

    const descTranslateY = scrollX.interpolate({
      inputRange,
      outputRange: [60, 0, -60],
      extrapolate: 'clamp',
    });

    const iconOpacity = scrollX.interpolate({
      inputRange,
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    });

    return (
      <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
        <View style={[styles.slideBackground, { backgroundColor: item.bgGradientTop }]}>
          <View style={styles.bgPattern}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.bgCircle,
                  {
                    width: 120 + i * 60,
                    height: 120 + i * 60,
                    borderRadius: 60 + i * 30,
                    opacity: 0.06 - i * 0.008,
                    top: SCREEN_HEIGHT * 0.15 - (i * 30),
                    left: SCREEN_WIDTH * 0.5 - (60 + i * 30),
                  },
                ]}
              />
            ))}
          </View>

          <View style={[styles.slideContent, { paddingTop: insets.top + 80 }]}>
            <Animated.View
              style={[
                styles.iconContainer,
                {
                  opacity: iconOpacity,
                  transform: [{ scale: iconScale }],
                  backgroundColor: 'rgba(255,255,255,0.15)',
                },
              ]}
            >
              {item.icon}
            </Animated.View>

            <Animated.View
              style={{
                opacity: titleOpacity,
                transform: [{ translateY: titleTranslateY }],
              }}
            >
              <Text style={styles.slideTitle}>{item.title}</Text>
              <Text style={styles.slideSubtitle}>{item.subtitle}</Text>
            </Animated.View>

            <Animated.View
              style={[
                styles.descriptionCard,
                {
                  opacity: descOpacity,
                  transform: [{ translateY: descTranslateY }],
                },
              ]}
            >
              <Text style={styles.slideDescription}>{item.description}</Text>
            </Animated.View>

            {index === 0 && (
              <Animated.View style={[styles.featureList, { opacity: descOpacity }]}>
                {[
                  'Cost estimation with bulk pricing',
                  'Interactive schedule timelines',
                  'Professional PDF generation',
                  'Team collaboration tools',
                ].map((feature, fi) => (
                  <View key={fi} style={styles.featureItem}>
                    <CheckCircle size={16} color="rgba(255,255,255,0.9)" strokeWidth={2} />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </Animated.View>
            )}
          </View>
        </View>
      </View>
    );
  }, [scrollX, iconScale, insets.top]);

  return (
    <View style={styles.container}>
      <Animated.FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true }
        )}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />

      <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.paginationRow}>
          {SLIDES.map((slide, i) => {
            const inputRange = [
              (i - 1) * SCREEN_WIDTH,
              i * SCREEN_WIDTH,
              (i + 1) * SCREEN_WIDTH,
            ];

            const dotScale = scrollX.interpolate({
              inputRange,
              outputRange: [1, 3.5, 1],
              extrapolate: 'clamp',
            });

            const dotOpacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.35, 1, 0.35],
              extrapolate: 'clamp',
            });

            return (
              <Animated.View
                key={slide.id}
                style={[
                  styles.dot,
                  {
                    transform: [{ scaleX: dotScale }],
                    opacity: dotOpacity,
                    backgroundColor: '#FFFFFF',
                  },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.buttonRow}>
          {!isLastSlide && (
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
              activeOpacity={0.7}
              testID="onboarding-skip"
            >
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          )}

          <Animated.View style={{ transform: [{ scale: buttonScale }], flex: isLastSlide ? 1 : undefined }}>
            <TouchableOpacity
              style={[
                styles.nextButton,
                isLastSlide && styles.getStartedButton,
              ]}
              onPress={handleNext}
              activeOpacity={0.85}
              testID="onboarding-next"
            >
              <Text style={[styles.nextButtonText, isLastSlide && styles.getStartedText]}>
                {isLastSlide ? "Let's Build" : 'Next'}
              </Text>
              {!isLastSlide && (
                <ArrowRight size={18} color="#FFFFFF" strokeWidth={2.5} />
              )}
              {isLastSlide && (
                <HardHat size={20} color={Colors.primary} strokeWidth={2} />
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  slide: {
    flex: 1,
  },
  slideBackground: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  bgPattern: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bgCircle: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
  },
  slideContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  slideTitle: {
    fontSize: 36,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  slideSubtitle: {
    fontSize: 17,
    fontWeight: '500' as const,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: 28,
  },
  descriptionCard: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  slideDescription: {
    fontSize: 16,
    lineHeight: 24,
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    fontWeight: '400' as const,
  },
  featureList: {
    marginTop: 28,
    width: '100%',
    gap: 14,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 8,
  },
  featureText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '500' as const,
  },
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 24,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  skipButton: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  skipText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.7)',
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  nextButtonText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  getStartedButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  getStartedText: {
    color: Colors.primary,
  },
});

```


---

### `app/onboarding-paywall.tsx`

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  X,
  HardHat,
  Calculator,
  CalendarDays,
  FileText,
  ClipboardList,
  Mic,
  BookOpen,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSubscription } from '@/contexts/SubscriptionContext';

/**
 * Onboarding-style paywall — single-screen, trial-narrative, big-CTA
 * pattern popularized by Cal AI / Opal / Oasis / Superhuman. Different
 * audience than `app/paywall.tsx` (the settings upgrade comparison
 * table): this screen is shown immediately after the onboarding carousel
 * for net-new users, and re-shown to free-tier users for their first
 * three days (see the 3-day gate in `app/_layout.tsx`).
 *
 * Why this layout works:
 *   - One tier is featured, not three — removes "which plan?" paralysis.
 *   - Annual is the default selection with a visible savings badge, so
 *     the psychologically cheaper-per-month number lands first.
 *   - Business is still reachable via a secondary tab so power users
 *     aren't pushed into the wrong plan.
 *   - Dismissable. The X sends the user to /home; we never hard-gate
 *     the app behind the paywall post-signup.
 *
 * Pricing is resolved from RevenueCat packages when available, falling
 * back to the canonical strings the user signed off on. Keeping fallbacks
 * means the screen renders correctly even before RC offerings have
 * hydrated (cold boot, offline, or a mis-configured build).
 */

const STORAGE_KEY_FIRST_SEEN = 'buildwise_onboarding_paywall_first_at';
const STORAGE_KEY_LAST_SEEN = 'buildwise_onboarding_paywall_last_at';

// Canonical pricing the user specified. Used as a fallback when RC hasn't
// loaded, and as source-of-truth for copy like "Save 20%" derivation.
const FALLBACK_PRICING = {
  proMonthly: '$29.99',
  proAnnualPerMonth: '$24.16',
  proAnnualTotal: '$289.99',
  businessMonthly: '$79.99',
  businessAnnualPerMonth: '$64.16',
  businessAnnualTotal: '$769.99',
} as const;

type Plan = 'pro' | 'business';
type Period = 'monthly' | 'annual';

interface Feature {
  title: string;
  description: string;
  Icon: typeof HardHat;
}

const FEATURES: Feature[] = [
  {
    title: 'AI Cost Estimator',
    description: 'Turn a scope description into a line-item estimate in seconds.',
    Icon: Calculator,
  },
  {
    title: 'Schedule Maker',
    description: 'Generate critical-path Gantt schedules with crew and phase logic.',
    Icon: CalendarDays,
  },
  {
    title: 'PDF Export & Sharing',
    description: 'Export estimates, invoices, and reports as branded PDFs.',
    Icon: FileText,
  },
  {
    title: 'Daily Field Reports',
    description: 'Log work completed, issues, and weather from the field.',
    Icon: ClipboardList,
  },
  {
    title: 'Voice-to-Report',
    description: 'Dictate updates and let MAGE build the report for you.',
    Icon: Mic,
  },
  {
    title: 'Construction AI',
    description: 'Look up building codes, permits, and inspection requirements.',
    Icon: BookOpen,
  },
];

export default function OnboardingPaywallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    purchasePro,
    purchaseBusiness,
    restorePurchases,
    proPackage,
    proAnnualPackage,
    businessPackage,
    businessAnnualPackage,
    isPurchasing,
    isLoading,
  } = useSubscription();

  const [selectedPlan, setSelectedPlan] = useState<Plan>('pro');
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('annual');

  // Stamp first-seen on mount so the 3-day gate has an anchor. `setItem`
  // is a no-op if the key already exists (via getItem check) — we never
  // want to reset the 3-day countdown just because the user re-opens.
  useEffect(() => {
    (async () => {
      try {
        const existing = await AsyncStorage.getItem(STORAGE_KEY_FIRST_SEEN);
        if (!existing) {
          await AsyncStorage.setItem(
            STORAGE_KEY_FIRST_SEEN,
            new Date().toISOString(),
          );
        }
        await AsyncStorage.setItem(
          STORAGE_KEY_LAST_SEEN,
          new Date().toISOString(),
        );
      } catch (err) {
        console.log('[OnboardingPaywall] storage stamp failed', err);
      }
    })();
  }, []);

  // Pull prices from RC when available, otherwise fall back to canonical
  // strings. We don't derive the annual "per month" price from RC's
  // totalled annual figure because intro-pricing and locale formatting
  // can make the math off by a cent — the hand-authored per-month copy
  // is what the user expects to see.
  const pricing = useMemo(() => {
    return {
      proMonthly: proPackage?.product?.priceString ?? FALLBACK_PRICING.proMonthly,
      proAnnualPerMonth: FALLBACK_PRICING.proAnnualPerMonth,
      proAnnualTotal:
        proAnnualPackage?.product?.priceString ?? FALLBACK_PRICING.proAnnualTotal,
      businessMonthly:
        businessPackage?.product?.priceString ?? FALLBACK_PRICING.businessMonthly,
      businessAnnualPerMonth: FALLBACK_PRICING.businessAnnualPerMonth,
      businessAnnualTotal:
        businessAnnualPackage?.product?.priceString ??
        FALLBACK_PRICING.businessAnnualTotal,
    };
  }, [proPackage, proAnnualPackage, businessPackage, businessAnnualPackage]);

  const handleClose = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // Stamp last-seen so today's gate doesn't immediately re-show on next boot.
    void AsyncStorage.setItem(STORAGE_KEY_LAST_SEEN, new Date().toISOString());
    router.replace('/(tabs)/(home)');
  }, [router]);

  const handlePurchase = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (selectedPlan === 'pro') {
        await purchasePro(selectedPeriod);
      } else {
        await purchaseBusiness(selectedPeriod);
      }
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(
        'Welcome to MAGE ID ' + (selectedPlan === 'pro' ? 'Pro' : 'Business') + '!',
        'Your subscription is active.',
      );
      router.replace('/(tabs)/(home)');
    } catch (err: unknown) {
      const cancelled =
        err &&
        typeof err === 'object' &&
        'userCancelled' in err &&
        (err as { userCancelled: boolean }).userCancelled;
      if (cancelled) return;
      console.log('[OnboardingPaywall] purchase failed', err);
      Alert.alert(
        'Purchase Failed',
        'Something went wrong. Please try again, or tap Restore if you already purchased.',
      );
    }
  }, [selectedPlan, selectedPeriod, purchasePro, purchaseBusiness, router]);

  const handleRestore = useCallback(async () => {
    try {
      await restorePurchases();
      Alert.alert('Restored', 'Your purchases have been restored.');
      router.replace('/(tabs)/(home)');
    } catch (err) {
      console.log('[OnboardingPaywall] restore failed', err);
      Alert.alert('Nothing to Restore', 'We couldn\'t find an active subscription.');
    }
  }, [restorePurchases, router]);

  const openLegal = useCallback((kind: 'privacy' | 'terms') => {
    const url =
      kind === 'privacy'
        ? 'https://mageid.com/privacy'
        : 'https://mageid.com/terms';
    void Linking.openURL(url);
  }, []);

  // CTA copy shifts with the selection so the button reads like the
  // specific action the user is about to take.
  const ctaLabel = useMemo(() => {
    if (isPurchasing) return 'Processing…';
    const planLabel = selectedPlan === 'pro' ? 'Pro' : 'Business';
    return `Start MAGE ID ${planLabel}`;
  }, [selectedPlan, isPurchasing]);

  const priceFootnote = useMemo(() => {
    if (selectedPlan === 'pro') {
      return selectedPeriod === 'annual'
        ? `${pricing.proAnnualPerMonth}/mo · billed annually (${pricing.proAnnualTotal}/yr)`
        : `${pricing.proMonthly}/mo · billed monthly`;
    }
    return selectedPeriod === 'annual'
      ? `${pricing.businessAnnualPerMonth}/mo · billed annually (${pricing.businessAnnualTotal}/yr)`
      : `${pricing.businessMonthly}/mo · billed monthly`;
  }, [selectedPlan, selectedPeriod, pricing]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header: brand lockup + close */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandBadge}>
            <HardHat size={14} color={Colors.primary} strokeWidth={2.4} />
          </View>
          <Text style={styles.brandName}>MAGE ID</Text>
        </View>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={handleClose}
          testID="onboarding-paywall-close"
        >
          <X size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.hero}>Unlock every tool on the jobsite</Text>

        {/* Feature list with vertical gradient rail */}
        <View style={styles.featureBlock}>
          <View style={styles.railWrap} pointerEvents="none">
            <LinearGradient
              colors={[Colors.primary, Colors.primary + '55']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.rail}
            />
          </View>
          {FEATURES.map((f, i) => {
            const Icon = f.Icon;
            return (
              <View key={f.title} style={styles.featureRow}>
                <View style={styles.railIconWrap}>
                  <View
                    style={[
                      styles.railIcon,
                      {
                        // Alternate between solid and tinted so the rail
                        // reads as a gradient with "stops" rather than a
                        // flat color block.
                        backgroundColor:
                          i % 2 === 0 ? Colors.primary : Colors.primary + 'DD',
                      },
                    ]}
                  >
                    <Icon size={16} color={Colors.textOnPrimary} strokeWidth={2.2} />
                  </View>
                </View>
                <View style={styles.featureCopy}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureDesc}>{f.description}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Period toggle */}
        <View style={styles.periodToggle}>
          <TouchableOpacity
            style={[
              styles.periodOption,
              selectedPeriod === 'annual' && styles.periodOptionActive,
            ]}
            onPress={() => {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              setSelectedPeriod('annual');
            }}
            testID="period-annual"
          >
            <Text
              style={[
                styles.periodLabel,
                selectedPeriod === 'annual' && styles.periodLabelActive,
              ]}
            >
              Annual
            </Text>
            <View style={styles.saveBadge}>
              <Text style={styles.saveBadgeText}>SAVE 20%</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.periodOption,
              selectedPeriod === 'monthly' && styles.periodOptionActive,
            ]}
            onPress={() => {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              setSelectedPeriod('monthly');
            }}
            testID="period-monthly"
          >
            <Text
              style={[
                styles.periodLabel,
                selectedPeriod === 'monthly' && styles.periodLabelActive,
              ]}
            >
              Monthly
            </Text>
          </TouchableOpacity>
        </View>

        {/* Plan cards */}
        <View style={styles.planRow}>
          <PlanCard
            label="Pro"
            tagline="For active GCs"
            priceTop={
              selectedPeriod === 'annual' ? pricing.proAnnualPerMonth : pricing.proMonthly
            }
            priceBottom={
              selectedPeriod === 'annual'
                ? `${pricing.proAnnualTotal}/yr`
                : 'billed monthly'
            }
            active={selectedPlan === 'pro'}
            onPress={() => {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              setSelectedPlan('pro');
            }}
            testID="plan-pro"
            featured
          />
          <PlanCard
            label="Business"
            tagline="Teams & unlimited"
            priceTop={
              selectedPeriod === 'annual'
                ? pricing.businessAnnualPerMonth
                : pricing.businessMonthly
            }
            priceBottom={
              selectedPeriod === 'annual'
                ? `${pricing.businessAnnualTotal}/yr`
                : 'billed monthly'
            }
            active={selectedPlan === 'business'}
            onPress={() => {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              setSelectedPlan('business');
            }}
            testID="plan-business"
          />
        </View>

        <Text style={styles.priceFootnote}>{priceFootnote}</Text>

        <TouchableOpacity
          style={[styles.cta, isPurchasing && styles.ctaDisabled]}
          onPress={handlePurchase}
          disabled={isPurchasing || isLoading}
          activeOpacity={0.88}
          testID="onboarding-paywall-cta"
        >
          {isPurchasing ? (
            <ActivityIndicator color={Colors.textOnPrimary} size="small" />
          ) : (
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.reassurance}>
          Cancel anytime in Settings. No hidden fees.
        </Text>

        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => openLegal('privacy')}>
            <Text style={styles.legalLink}>Privacy</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>·</Text>
          <TouchableOpacity onPress={handleRestore}>
            <Text style={styles.legalLink}>Restore</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>·</Text>
          <TouchableOpacity onPress={() => openLegal('terms')}>
            <Text style={styles.legalLink}>Terms</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

interface PlanCardProps {
  label: string;
  tagline: string;
  priceTop: string;
  priceBottom: string;
  active: boolean;
  featured?: boolean;
  onPress: () => void;
  testID?: string;
}

function PlanCard({
  label,
  tagline,
  priceTop,
  priceBottom,
  active,
  featured,
  onPress,
  testID,
}: PlanCardProps) {
  return (
    <TouchableOpacity
      style={[styles.planCard, active && styles.planCardActive]}
      onPress={onPress}
      activeOpacity={0.85}
      testID={testID}
    >
      {featured && (
        <View style={styles.popularBadge}>
          <Text style={styles.popularBadgeText}>POPULAR</Text>
        </View>
      )}
      <Text style={[styles.planLabel, active && styles.planLabelActive]}>{label}</Text>
      <Text style={styles.planTagline}>{tagline}</Text>
      <View style={styles.planPriceBlock}>
        <Text style={[styles.planPriceTop, active && styles.planPriceTopActive]}>
          {priceTop}
        </Text>
        <Text style={styles.planPriceUnit}>/mo</Text>
      </View>
      <Text style={styles.planPriceBottom}>{priceBottom}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandBadge: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: Colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  hero: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.8,
    marginBottom: 28,
  },
  featureBlock: {
    position: 'relative',
    marginBottom: 24,
  },
  railWrap: {
    position: 'absolute',
    left: 16,
    top: 8,
    bottom: 8,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rail: {
    width: 36,
    height: '100%',
    borderRadius: 18,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 18,
    minHeight: 52,
  },
  railIconWrap: {
    width: 68,
    alignItems: 'center',
    paddingTop: 2,
  },
  railIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCopy: {
    flex: 1,
    paddingTop: 2,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  featureDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  periodToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  periodOption: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    flexDirection: 'row',
    gap: 6,
  },
  periodOptionActive: {
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  periodLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  periodLabelActive: {
    color: Colors.text,
  },
  saveBadge: {
    backgroundColor: Colors.success + '25',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  saveBadgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: Colors.success,
    letterSpacing: 0.4,
  },
  planRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  planCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 14,
    position: 'relative',
    minHeight: 140,
  },
  planCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  popularBadge: {
    position: 'absolute',
    top: -9,
    right: 10,
    backgroundColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  popularBadgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: Colors.textOnPrimary,
    letterSpacing: 0.6,
  },
  planLabel: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  planLabelActive: {
    color: Colors.primary,
  },
  planTagline: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
    marginBottom: 14,
  },
  planPriceBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  planPriceTop: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.6,
  },
  planPriceTopActive: {
    color: Colors.primary,
  },
  planPriceUnit: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },
  planPriceBottom: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  priceFootnote: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 14,
  },
  cta: {
    height: 54,
    borderRadius: 14,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaLabel: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  reassurance: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 16,
  },
  legalLink: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  legalDot: {
    fontSize: 12,
    color: Colors.textMuted,
  },
});

```


---

### `app/paywall.tsx`

```tsx
import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  CheckCircle, XCircle, Crown, Zap, Building2, X, Shield,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSubscription } from '@/contexts/SubscriptionContext';

interface FeatureRow {
  label: string;
  free: boolean;
  pro: boolean;
  business: boolean;
}

const FEATURES: FeatureRow[] = [
  { label: 'Active Projects', free: true, pro: true, business: true },
  { label: 'AI Cost Estimator', free: true, pro: true, business: true },
  { label: 'PDF Export & Sharing', free: false, pro: true, business: true },
  { label: 'Schedule Maker (Gantt)', free: false, pro: true, business: true },
  { label: 'Change Orders & Invoicing', free: false, pro: true, business: true },
  { label: 'Daily Field Reports', free: false, pro: true, business: true },
  { label: 'Voice-to-Report', free: false, pro: true, business: true },
  { label: 'Photo Documentation', free: false, pro: true, business: true },
  { label: 'Price Alerts', free: false, pro: true, business: true },
  { label: 'Equipment Tracking', free: false, pro: true, business: true },
  { label: 'Budget Health (EVM)', free: false, pro: true, business: true },
  { label: 'Subcontractor Management', free: false, pro: false, business: true },
  { label: 'Punch List & Closeout', free: false, pro: false, business: true },
  { label: 'RFIs & Submittals', free: false, pro: false, business: true },
  { label: 'Full Budget Dashboard', free: false, pro: false, business: true },
  { label: 'Client Portal', free: false, pro: false, business: true },
];

function FeatureCheck({ available }: { available: boolean }) {
  return available
    ? <CheckCircle size={16} color={Colors.success} />
    : <XCircle size={16} color={Colors.textMuted} />;
}

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    tier, purchasePro, purchaseBusiness, restorePurchases,
    isLoading, isPurchasing, proPackage, businessPackage,
  } = useSubscription();

  const packagesLoaded = !!proPackage || !!businessPackage;
  const packagesStillLoading = isLoading && !packagesLoaded;

  const proPrice = proPackage?.product?.priceString ?? (packagesStillLoading ? null : '$24.16/mo');
  const businessPrice = businessPackage?.product?.priceString ?? (packagesStillLoading ? null : '$63.99/mo');
  const isFallbackPricing = !packagesLoaded && !packagesStillLoading;

  const handlePurchasePro = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await purchasePro();
      Alert.alert('Welcome to Pro!', 'You now have access to all Pro features.');
      router.back();
    } catch (err: unknown) {
      const isCancelled = err && typeof err === 'object' && 'userCancelled' in err && (err as { userCancelled: boolean }).userCancelled;
      if (isCancelled) {
        console.log('[Paywall] User cancelled Pro purchase');
        return;
      }
      console.log('[Paywall] Purchase Pro failed:', err);
      Alert.alert('Purchase Failed', 'Could not complete the purchase. Please try again.');
    }
  }, [purchasePro, router]);

  const handlePurchaseBusiness = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await purchaseBusiness();
      Alert.alert('Welcome to Business!', 'You now have access to all features.');
      router.back();
    } catch (err: unknown) {
      const isCancelled = err && typeof err === 'object' && 'userCancelled' in err && (err as { userCancelled: boolean }).userCancelled;
      if (isCancelled) {
        console.log('[Paywall] User cancelled Business purchase');
        return;
      }
      console.log('[Paywall] Purchase Business failed:', err);
      Alert.alert('Purchase Failed', 'Could not complete the purchase. Please try again.');
    }
  }, [purchaseBusiness, router]);

  const handleRestore = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await restorePurchases();
      Alert.alert('Restored', 'Your purchases have been restored.');
    } catch (err) {
      console.log('[Paywall] Restore failed:', err);
      Alert.alert('Restore Failed', 'Could not restore purchases. Please try again.');
    }
  }, [restorePurchases]);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} testID="paywall-close">
          <X size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose Your Plan</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.plansRow}>
          <View style={[styles.planCard, tier === 'free' && styles.planCardActive]}>
            <View style={[styles.planIconWrap, { backgroundColor: Colors.fillTertiary }]}>
              <Zap size={20} color={Colors.textSecondary} />
            </View>
            <Text style={styles.planName}>Free</Text>
            <Text style={styles.planPrice}>$0</Text>
            <Text style={styles.planPeriod}>forever</Text>
            {tier === 'free' && (
              <View style={[styles.currentBadge, { backgroundColor: Colors.fillTertiary }]}>
                <Text style={[styles.currentBadgeText, { color: Colors.textSecondary }]}>Current</Text>
              </View>
            )}
          </View>

          <View style={[styles.planCard, styles.planCardHighlight, tier === 'pro' && styles.planCardActive]}>
            <View style={styles.popularTag}>
              <Text style={styles.popularTagText}>POPULAR</Text>
            </View>
            <View style={[styles.planIconWrap, { backgroundColor: Colors.primary + '20' }]}>
              <Crown size={20} color={Colors.primary} />
            </View>
            <Text style={styles.planName}>Pro</Text>
            {proPrice ? (
              <Text style={styles.planPrice}>{proPrice}</Text>
            ) : (
              <ActivityIndicator size="small" color={Colors.primary} style={{ height: 22 }} />
            )}
            <Text style={styles.planPeriod}>per month</Text>
            {tier === 'pro' ? (
              <View style={[styles.currentBadge, { backgroundColor: Colors.success + '20' }]}>
                <Text style={[styles.currentBadgeText, { color: Colors.success }]}>Current</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.ctaBtn, isFallbackPricing && styles.ctaBtnDisabled]}
                onPress={handlePurchasePro}
                activeOpacity={0.85}
                disabled={isPurchasing || isFallbackPricing}
                testID="buy-pro"
              >
                {isPurchasing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.ctaBtnText}>Subscribe</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          <View style={[styles.planCard, tier === 'business' && styles.planCardActive]}>
            <View style={[styles.planIconWrap, { backgroundColor: Colors.accent + '20' }]}>
              <Building2 size={20} color={Colors.accent} />
            </View>
            <Text style={styles.planName}>Business</Text>
            {businessPrice ? (
              <Text style={styles.planPrice}>{businessPrice}</Text>
            ) : (
              <ActivityIndicator size="small" color={Colors.accent} style={{ height: 22 }} />
            )}
            <Text style={styles.planPeriod}>per month</Text>
            {tier === 'business' ? (
              <View style={[styles.currentBadge, { backgroundColor: Colors.success + '20' }]}>
                <Text style={[styles.currentBadgeText, { color: Colors.success }]}>Current</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.ctaBtn, { backgroundColor: Colors.accent }, isFallbackPricing && styles.ctaBtnDisabled]}
                onPress={handlePurchaseBusiness}
                activeOpacity={0.85}
                disabled={isPurchasing || isFallbackPricing}
                testID="buy-business"
              >
                {isPurchasing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.ctaBtnText}>Subscribe</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.compareTitle}>Feature Comparison</Text>
        <View style={styles.compareTable}>
          <View style={styles.compareHeaderRow}>
            <Text style={[styles.compareCell, styles.compareLabelCell]}>Feature</Text>
            <Text style={[styles.compareCell, styles.compareHeaderCell]}>Free</Text>
            <Text style={[styles.compareCell, styles.compareHeaderCell]}>Pro</Text>
            <Text style={[styles.compareCell, styles.compareHeaderCell]}>Biz</Text>
          </View>
          {FEATURES.map((f) => (
            <View key={f.label} style={styles.compareRow}>
              <Text style={[styles.compareCell, styles.compareLabelCell]} numberOfLines={2}>{f.label}</Text>
              <View style={[styles.compareCell, styles.compareCenterCell]}>
                <FeatureCheck available={f.free} />
              </View>
              <View style={[styles.compareCell, styles.compareCenterCell]}>
                <FeatureCheck available={f.pro} />
              </View>
              <View style={[styles.compareCell, styles.compareCenterCell]}>
                <FeatureCheck available={f.business} />
              </View>
            </View>
          ))}
        </View>

        <View style={styles.trustRow}>
          <Shield size={14} color={Colors.textSecondary} />
          <Text style={styles.trustText}>
            Secure payment via {Platform.OS === 'ios' ? 'App Store' : Platform.OS === 'android' ? 'Google Play' : 'your platform'}. Cancel anytime.
          </Text>
        </View>

        {isFallbackPricing && (
          <View style={styles.fallbackNotice}>
            <Text style={styles.fallbackNoticeText}>
              Prices shown are estimates. In-app purchasing is currently unavailable.
            </Text>
          </View>
        )}

        <TouchableOpacity onPress={handleRestore} style={styles.restoreBtn} disabled={isFallbackPricing} testID="restore-purchases">
          <Text style={[styles.restoreText, isFallbackPricing && { color: Colors.textMuted }]}>Restore Purchases</Text>
        </TouchableOpacity>

        {packagesStillLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={Colors.primary} size="small" />
            <Text style={styles.loadingText}>Loading plans...</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  plansRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
  },
  planCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative' as const,
    overflow: 'visible' as const,
  },
  planCardHighlight: {
    borderColor: Colors.primary + '30',
  },
  planCardActive: {
    borderColor: Colors.success,
  },
  popularTag: {
    position: 'absolute' as const,
    top: -10,
    backgroundColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    zIndex: 1,
  },
  popularTagText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: '#fff',
    letterSpacing: 0.5,
  },
  planIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    marginTop: 4,
  },
  planName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  planPrice: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  planPeriod: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  currentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  ctaBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    width: '100%' as const,
    alignItems: 'center',
  },
  ctaBtnText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#fff',
  },
  compareTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  compareTable: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
  },
  compareHeaderRow: {
    flexDirection: 'row',
    backgroundColor: Colors.fillSecondary,
    paddingVertical: 10,
  },
  compareRow: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
    paddingVertical: 10,
  },
  compareCell: {
    width: 50,
    paddingHorizontal: 4,
  },
  compareLabelCell: {
    flex: 1,
    paddingLeft: 14,
    fontSize: 13,
    color: Colors.text,
    fontWeight: '400' as const,
  },
  compareHeaderCell: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  compareCenterCell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  trustText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  restoreBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
  },
  restoreText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  loadingOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  fallbackNotice: {
    backgroundColor: Colors.fillSecondary,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  fallbackNoticeText: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 18,
  },
  ctaBtnDisabled: {
    opacity: 0.45,
  },
});

```


---

### `components/Paywall.tsx`

```tsx
import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Crown, Building2, CheckCircle2, X, Sparkles, Shield } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSubscription } from '@/contexts/SubscriptionContext';

type RequiredTier = 'pro' | 'business';
type BillingPeriod = 'monthly' | 'annual';

interface PaywallProps {
  visible: boolean;
  onClose: () => void;
  /** Display name of the feature the user tried to access, e.g. "Cash Flow Forecaster". */
  feature: string;
  /** Minimum tier required for this feature. */
  requiredTier: RequiredTier;
}

// Fallback prices shown when RevenueCat offerings haven't loaded yet or the
// store isn't available. These mirror the App Store Connect product prices.
const FALLBACK_PRICES = {
  pro: { monthly: '$29.99', annual: '$289.99', annualMonthlyEquivalent: '$24.16' },
  business: { monthly: '$79.99', annual: '$769.99', annualMonthlyEquivalent: '$64.16' },
} as const;

const PRO_BENEFITS: string[] = [
  'Unlimited projects and estimates',
  'Cash Flow Forecaster & Budget Health',
  'Schedule Maker with Gantt & PDF export',
  'Daily Field Reports with photos',
  'AI Code Check (20/day) & Voice-to-Report',
  'Client Portal for your customers',
  'Lien Waivers, Proposals, Change Orders',
  'Equipment tracking & Price Alerts',
];

const BUSINESS_BENEFITS: string[] = [
  'Everything in Pro, plus:',
  'Unlimited AI Code Checks & bid responses',
  'Time Tracking for crews',
  'QuickBooks sync',
  'Plan Viewer & markup tools',
  'Subcontractor management',
  'Punch List & Closeout packets',
  'RFIs, Submittals, and full Budget Dashboard',
];

export default function Paywall({ visible, onClose, feature, requiredTier }: PaywallProps) {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<BillingPeriod>('annual');
  const {
    purchasePro,
    purchaseBusiness,
    proPackage,
    proAnnualPackage,
    businessPackage,
    businessAnnualPackage,
    isPurchasing,
  } = useSubscription();

  const tierLabel = requiredTier === 'business' ? 'Business' : 'Pro';
  const tierColor = requiredTier === 'business' ? Colors.accent : Colors.primary;
  const TierIcon = requiredTier === 'business' ? Building2 : Crown;
  const benefits = requiredTier === 'business' ? BUSINESS_BENEFITS : PRO_BENEFITS;
  const fallback = FALLBACK_PRICES[requiredTier];

  const pricing = useMemo(() => {
    // Try to use live RevenueCat pricing; fall back to static amounts.
    const monthlyPkg = requiredTier === 'business' ? businessPackage : proPackage;
    const annualPkg = requiredTier === 'business' ? businessAnnualPackage : proAnnualPackage;

    const monthlyPrice = monthlyPkg?.product?.priceString ?? fallback.monthly;
    const annualPrice = annualPkg?.product?.priceString ?? fallback.annual;

    // Compute annual "monthly equivalent" if we have live numbers.
    let monthlyEquivalent: string = fallback.annualMonthlyEquivalent;
    const annualCents = annualPkg?.product?.price;
    if (typeof annualCents === 'number' && annualCents > 0) {
      const perMonth = annualCents / 12;
      monthlyEquivalent = `$${perMonth.toFixed(2)}`;
    }

    return { monthlyPrice, annualPrice, monthlyEquivalent };
  }, [requiredTier, proPackage, proAnnualPackage, businessPackage, businessAnnualPackage, fallback]);

  const handleUpgrade = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (requiredTier === 'business') {
        await purchaseBusiness(period);
      } else {
        await purchasePro(period);
      }
      Alert.alert(`Welcome to ${tierLabel}!`, 'Your subscription is now active.');
      onClose();
    } catch (err: unknown) {
      const isCancelled =
        err && typeof err === 'object' && 'userCancelled' in err && (err as { userCancelled: boolean }).userCancelled;
      if (isCancelled) return;
      console.log('[Paywall modal] Purchase failed:', err);
      Alert.alert('Purchase Failed', 'Could not complete the purchase. Please try again.');
    }
  }, [purchasePro, purchaseBusiness, requiredTier, period, tierLabel, onClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 16 : insets.top + 8 }]}>
          <View style={{ width: 36 }} />
          <Text style={styles.headerTitle}>Upgrade Required</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} testID="paywall-modal-close">
            <X size={22} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.heroIconWrap, { backgroundColor: tierColor + '15' }]}>
            <TierIcon size={36} color={tierColor} />
          </View>

          <Text style={styles.featureName}>{feature}</Text>
          <Text style={styles.requiresLine}>
            Requires <Text style={[styles.requiresTierEm, { color: tierColor }]}>{tierLabel}</Text>
          </Text>

          <View style={styles.benefitsBox}>
            {benefits.map((b, idx) => (
              <View key={idx} style={styles.benefitRow}>
                <CheckCircle2 size={16} color={tierColor} />
                <Text style={styles.benefitText}>{b}</Text>
              </View>
            ))}
          </View>

          {/* Monthly / Annual toggle */}
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, period === 'monthly' && styles.toggleBtnActive]}
              onPress={() => setPeriod('monthly')}
              activeOpacity={0.8}
              testID="paywall-period-monthly"
            >
              <Text style={[styles.toggleText, period === 'monthly' && styles.toggleTextActive]}>Monthly</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, period === 'annual' && styles.toggleBtnActive]}
              onPress={() => setPeriod('annual')}
              activeOpacity={0.8}
              testID="paywall-period-annual"
            >
              <Text style={[styles.toggleText, period === 'annual' && styles.toggleTextActive]}>Annual</Text>
              <View style={styles.saveBadge}>
                <Text style={styles.saveBadgeText}>Save 20%</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Price display */}
          <View style={styles.priceBox}>
            {period === 'monthly' ? (
              <>
                <Text style={styles.priceBig}>{pricing.monthlyPrice}</Text>
                <Text style={styles.priceSub}>per month, cancel anytime</Text>
              </>
            ) : (
              <>
                <Text style={styles.priceBig}>{pricing.monthlyEquivalent}/mo</Text>
                <Text style={styles.priceSub}>billed {pricing.annualPrice} annually</Text>
              </>
            )}
          </View>

          <TouchableOpacity
            style={[styles.upgradeBtn, { backgroundColor: tierColor }]}
            onPress={handleUpgrade}
            disabled={isPurchasing}
            activeOpacity={0.85}
            testID="paywall-upgrade-btn"
          >
            {isPurchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Sparkles size={18} color="#fff" />
                <Text style={styles.upgradeBtnText}>Upgrade to {tierLabel}</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.notNowBtn} testID="paywall-not-now">
            <Text style={styles.notNowText}>Not now</Text>
          </TouchableOpacity>

          <View style={styles.trustRow}>
            <Shield size={13} color={Colors.textSecondary} />
            <Text style={styles.trustText}>
              Secure payment via {Platform.OS === 'ios' ? 'App Store' : Platform.OS === 'android' ? 'Google Play' : 'your platform'}. Cancel anytime.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  headerTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, alignItems: 'center' },
  heroIconWrap: {
    width: 76, height: 76, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  featureName: {
    fontSize: 22, fontWeight: '800' as const, color: Colors.text,
    letterSpacing: -0.4, textAlign: 'center', marginBottom: 4,
  },
  requiresLine: { fontSize: 15, color: Colors.textSecondary, marginBottom: 22 },
  requiresTierEm: { fontWeight: '700' as const },
  benefitsBox: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: 20,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  benefitText: { flex: 1, fontSize: 14, color: Colors.text, lineHeight: 20 },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: Colors.fillTertiary,
    padding: 4,
    borderRadius: 12,
    marginBottom: 14,
    width: '100%',
    gap: 4,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  toggleBtnActive: {
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  toggleText: { fontSize: 14, fontWeight: '600' as const, color: Colors.textSecondary },
  toggleTextActive: { color: Colors.text },
  saveBadge: {
    backgroundColor: Colors.success + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  saveBadgeText: { fontSize: 10, fontWeight: '700' as const, color: Colors.success },
  priceBox: { alignItems: 'center', marginBottom: 20 },
  priceBig: { fontSize: 34, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.8 },
  priceSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  upgradeBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 12,
    marginBottom: 8,
  },
  upgradeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  notNowBtn: { paddingVertical: 12 },
  notNowText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' as const },
  trustRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    paddingHorizontal: 16,
  },
  trustText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },
});

```
