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
      router.replace('/(tabs)/summary' as any);
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
      router.replace('/(tabs)/summary' as any);
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
      router.replace('/(tabs)/summary' as any);
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
      router.replace('/(tabs)/summary' as any);
    } catch (err) {
      console.log('[Login] Apple login failed:', err);
    } finally {
      setIsAppleLoading(false);
    }
  }, [signInWithApple, router]);

  return (
    <View style={styles.container}>
      <View style={[styles.topSection, { paddingTop: insets.top + 36 }]}>
        {/* Decorative amber glow + concrete grid lines, mirroring the
            marketing site's "industrial concrete × tech" aesthetic. */}
        <View pointerEvents="none" style={styles.heroGlow} />
        <View pointerEvents="none" style={styles.heroGridH1} />
        <View pointerEvents="none" style={styles.heroGridH2} />
        <View pointerEvents="none" style={styles.heroGridV1} />
        <View pointerEvents="none" style={styles.heroGridV2} />

        <View style={styles.brandRow}>
          <View style={styles.logoChip}>
            <HardHat size={16} color="#FF6A1A" strokeWidth={2} />
          </View>
          <Text style={styles.brandWordmark}>MAGE ID</Text>
        </View>

        <Text style={styles.heroEyebrow}>WELCOME BACK</Text>
        <Text style={styles.heroLine}>
          Build it. <Text style={styles.heroLineAccent}>Bill it.</Text>
        </Text>
        <Text style={styles.heroLine}>
          Track every dollar.
        </Text>
        <Text style={styles.heroSub}>
          The operating system for general contractors.
        </Text>
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
  // Premium dark hero — matches the marketing site at https://mageid.app
  // Palette: --ink #0B0D10 + --amber #FF6A1A + --cream #F4EFE6.
  // Decorative grid + glow give the "industrial concrete × tech" feel
  // without an image asset.
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
  heroGridH1: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: '38%' as const,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  heroGridH2: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: '70%' as const,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  heroGridV1: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    left: '32%' as const,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  heroGridV2: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    left: '68%' as const,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
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
    borderRadius: 8,
    backgroundColor: 'rgba(255,106,26,0.12)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: 'rgba(255,106,26,0.24)',
  },
  brandWordmark: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#F4EFE6',
    letterSpacing: 2,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FF6A1A',
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
    color: '#FF6A1A',
    fontStyle: 'italic' as const,
    fontWeight: '700' as const,
  },
  heroSub: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#9AA3AD',
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
    backgroundColor: '#0B0D10',
    borderRadius: 14,
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
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#FF6A1A',
  },
});
