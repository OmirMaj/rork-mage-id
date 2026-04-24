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
import ConfirmEmailModal from '@/components/ConfirmEmailModal';

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
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');

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
      // Supabase fires a confirmation email. Show the "check your inbox" modal
      // instead of routing straight into the app — the session isn't valid
      // until they tap the link. AuthProvider's SIGNED_IN listener navigates
      // on confirmation, so we don't need to router.replace here.
      setPendingEmail(email.trim());
      setShowConfirmModal(true);
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
  }, [name, email, password, confirmPassword, signup, buttonScale, shake]);

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

      <ConfirmEmailModal
        visible={showConfirmModal}
        email={pendingEmail}
        onClose={() => setShowConfirmModal(false)}
        onChangeEmail={() => {
          setShowConfirmModal(false);
          setTimeout(() => emailRef.current?.focus(), 150);
        }}
      />
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
