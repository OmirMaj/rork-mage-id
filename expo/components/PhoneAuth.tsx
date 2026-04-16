import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Platform, Alert, Animated,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Phone, ArrowRight, ChevronLeft, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';

interface Props {
  onSuccess: () => void;
  onCancel: () => void;
  mode: 'login' | 'signup';
}

export default function PhoneAuth({ onSuccess, onCancel, mode }: Props) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const otpRefs = useRef<(TextInput | null)[]>([]);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const formattedPhone = `${countryCode}${phone.replace(/\D/g, '')}`;

  const handleSendCode = useCallback(async () => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setError('Please enter a valid phone number');
      shake();
      return;
    }

    setIsLoading(true);
    setError('');
    console.log('[PhoneAuth] Sending OTP to:', formattedPhone);

    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: formattedPhone,
      });

      if (otpError) {
        console.log('[PhoneAuth] OTP error:', otpError.message);
        if (otpError.message.includes('provider') || otpError.message.includes('not enabled')) {
          setError('Phone login coming soon. Please use email for now.');
        } else if (otpError.message.includes('rate')) {
          setError('Too many attempts. Please wait a moment.');
          setCooldown(60);
        } else {
          setError(otpError.message);
        }
        shake();
        return;
      }

      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setStep('otp');
      setCooldown(60);
      console.log('[PhoneAuth] OTP sent successfully');
    } catch (err) {
      console.error('[PhoneAuth] Send code error:', err);
      setError('Failed to send code. Please try again.');
      shake();
    } finally {
      setIsLoading(false);
    }
  }, [phone, formattedPhone, shake]);

  const handleVerifyOtp = useCallback(async (code: string) => {
    if (code.length !== 6) return;

    setIsLoading(true);
    setError('');
    console.log('[PhoneAuth] Verifying OTP for:', formattedPhone);

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone: formattedPhone,
        token: code,
        type: 'sms',
      });

      if (verifyError) {
        console.log('[PhoneAuth] Verify error:', verifyError.message);
        setError('Invalid code. Please try again.');
        setOtpDigits(['', '', '', '', '', '']);
        otpRefs.current[0]?.focus();
        shake();
        return;
      }

      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      console.log('[PhoneAuth] OTP verified successfully');
      onSuccess();
    } catch (err) {
      console.error('[PhoneAuth] Verify error:', err);
      setError('Verification failed. Please try again.');
      shake();
    } finally {
      setIsLoading(false);
    }
  }, [formattedPhone, onSuccess, shake]);

  const handleOtpChange = useCallback((index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...otpDigits];
    newDigits[index] = digit;
    setOtpDigits(newDigits);

    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    const fullCode = newDigits.join('');
    if (fullCode.length === 6) {
      void handleVerifyOtp(fullCode);
    }
  }, [otpDigits, handleVerifyOtp]);

  const handleOtpKeyPress = useCallback((index: number, key: string) => {
    if (key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
      const newDigits = [...otpDigits];
      newDigits[index - 1] = '';
      setOtpDigits(newDigits);
    }
  }, [otpDigits]);

  const handleResend = useCallback(async () => {
    if (cooldown > 0) return;
    await handleSendCode();
  }, [cooldown, handleSendCode]);

  if (step === 'otp') {
    return (
      <Animated.View style={[styles.container, { transform: [{ translateX: shakeAnim }] }]}>
        <Text style={styles.title}>Enter Verification Code</Text>
        <Text style={styles.subtitle}>
          Sent to {formattedPhone}
        </Text>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.otpRow}>
          {otpDigits.map((digit, i) => (
            <TextInput
              key={i}
              ref={ref => { otpRefs.current[i] = ref; }}
              style={[styles.otpInput, digit ? styles.otpInputFilled : null]}
              value={digit}
              onChangeText={v => handleOtpChange(i, v)}
              onKeyPress={({ nativeEvent }) => handleOtpKeyPress(i, nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              testID={`otp-${i}`}
            />
          ))}
        </View>

        {isLoading && <ActivityIndicator color={Colors.primary} style={{ marginTop: 16 }} />}

        <View style={styles.otpActions}>
          <TouchableOpacity
            onPress={handleResend}
            disabled={cooldown > 0}
            activeOpacity={0.7}
          >
            <View style={styles.resendRow}>
              <RefreshCw size={14} color={cooldown > 0 ? Colors.textMuted : Colors.primary} />
              <Text style={[styles.resendText, cooldown > 0 && { color: Colors.textMuted }]}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => { setStep('phone'); setError(''); }} activeOpacity={0.7}>
            <Text style={styles.changeNumberText}>Change Number</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.container, { transform: [{ translateX: shakeAnim }] }]}>
      <Text style={styles.title}>
        {mode === 'login' ? 'Log in with Phone' : 'Sign up with Phone'}
      </Text>
      <Text style={styles.subtitle}>
        We'll send a verification code to your number
      </Text>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.phoneRow}>
        <TouchableOpacity style={styles.countryCodeBtn} activeOpacity={0.7}>
          <Text style={styles.countryCodeText}>{countryCode}</Text>
        </TouchableOpacity>
        <View style={styles.phoneInputWrap}>
          <Phone size={18} color={Colors.textSecondary} />
          <TextInput
            style={styles.phoneInput}
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 123-4567"
            placeholderTextColor={Colors.textMuted}
            keyboardType="phone-pad"
            autoFocus
            testID="phone-input"
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.sendCodeBtn, isLoading && { opacity: 0.7 }]}
        onPress={handleSendCode}
        disabled={isLoading || cooldown > 0}
        activeOpacity={0.85}
        testID="send-code-btn"
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Text style={styles.sendCodeText}>Send Code</Text>
            <ArrowRight size={18} color="#fff" />
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.backBtn} onPress={onCancel} activeOpacity={0.7}>
        <ChevronLeft size={16} color={Colors.textSecondary} />
        <Text style={styles.backBtnText}>Use email instead</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  errorBanner: {
    backgroundColor: Colors.errorLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.15)',
  },
  errorText: {
    fontSize: 13,
    color: Colors.error,
    fontWeight: '500' as const,
    textAlign: 'center',
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  countryCodeBtn: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    justifyContent: 'center',
  },
  countryCodeText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  phoneInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  phoneInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
    paddingVertical: 14,
  },
  sendCodeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  sendCodeText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#fff',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    marginTop: 4,
  },
  backBtnText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginVertical: 20,
  },
  otpInput: {
    width: 46,
    height: 54,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  otpInputFilled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  otpActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  resendText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  changeNumberText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    paddingVertical: 8,
  },
});
