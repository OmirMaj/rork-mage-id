// ============================================================================
// components/ConfirmEmailModal.tsx
//
// Post-signup modal. Supabase fires the confirm-signup email automatically,
// but without a UI prompt users think signup failed when they can't log in.
// This modal explains what's happening, nudges them to check spam, and lets
// them resend or change their email.
//
// The modal is driven from signup.tsx: on a successful `signup()` call we
// open this instead of routing straight to /onboarding. The user's session
// isn't valid until they click the email link (assuming Supabase's "Confirm
// email" requirement is on) — navigation back to the app happens on the
// `onAuthStateChange` SIGNED_IN event inside AuthProvider.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Mail, CheckCircle2, AlertTriangle, Inbox, Shield, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';

interface ConfirmEmailModalProps {
  visible: boolean;
  email: string;
  onClose: () => void;
  onChangeEmail?: () => void;
}

const RESEND_COOLDOWN_SECONDS = 60;

export default function ConfirmEmailModal({
  visible, email, onClose, onChangeEmail,
}: ConfirmEmailModalProps) {
  const { resendConfirmation } = useAuth();

  const [isResending, setIsResending] = useState(false);
  const [resentAt, setResentAt] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'success' | 'error' | null>(null);
  const [secondsUntilResend, setSecondsUntilResend] = useState(0);

  // Count down the resend cooldown so the UI shows "Resend in 42s" instead
  // of silently failing when the user taps too fast.
  useEffect(() => {
    if (resentAt === null) { setSecondsUntilResend(0); return; }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - resentAt) / 1000);
      const remaining = Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);
      setSecondsUntilResend(remaining);
    };
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [resentAt]);

  // Clear transient state whenever the modal hides so a second open starts
  // clean. Intentional: we want users to be able to resend multiple times
  // across sessions, but one open shouldn't accumulate stale banners.
  useEffect(() => {
    if (!visible) {
      setStatusMessage(null);
      setStatusKind(null);
    }
  }, [visible]);

  const handleResend = useCallback(async () => {
    if (secondsUntilResend > 0) return;
    setIsResending(true);
    setStatusMessage(null);
    setStatusKind(null);
    try {
      await resendConfirmation(email);
      setResentAt(Date.now());
      setStatusKind('success');
      setStatusMessage('Sent — check your inbox again.');
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Could not resend. Try again in a minute.';
      // Supabase returns a clearer message when the account is already confirmed.
      const msg = raw.toLowerCase().includes('already')
        ? 'This email is already confirmed. You can sign in now.'
        : raw;
      setStatusKind('error');
      setStatusMessage(msg);
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } finally {
      setIsResending(false);
    }
  }, [resendConfirmation, email, secondsUntilResend]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Mail size={28} color={Colors.primary} strokeWidth={2} />
          </View>

          <Text style={styles.title}>Confirm your email</Text>
          <Text style={styles.subtitle}>
            We just sent a confirmation link to
          </Text>
          <Text style={styles.email} numberOfLines={1}>{email}</Text>

          <View style={styles.tips}>
            <Tip
              Icon={Inbox}
              title="Check your inbox"
              body="Tap the link in the email we sent to finish setting up your account."
            />
            <Tip
              Icon={Shield}
              title="Check Spam / Promotions"
              body="If you don't see it in a minute, it may have landed in Spam, Promotions, or Updates."
            />
            <Tip
              Icon={RefreshCw}
              title="Still nothing?"
              body="Tap Resend below, or double-check that the address above is correct."
            />
          </View>

          {statusMessage ? (
            <View style={[
              styles.statusBanner,
              statusKind === 'success' ? styles.statusBannerSuccess : styles.statusBannerError,
            ]}>
              {statusKind === 'success'
                ? <CheckCircle2 size={14} color="#1B5E20" />
                : <AlertTriangle size={14} color={Colors.error} />}
              <Text style={[
                styles.statusText,
                statusKind === 'success' ? styles.statusTextSuccess : styles.statusTextError,
              ]}>
                {statusMessage}
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (isResending || secondsUntilResend > 0) && styles.primaryBtnDisabled,
            ]}
            onPress={handleResend}
            disabled={isResending || secondsUntilResend > 0}
            activeOpacity={0.85}
            testID="confirm-email-resend"
          >
            {isResending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {secondsUntilResend > 0 ? `Resend in ${secondsUntilResend}s` : 'Resend email'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.secondaryRow}>
            {onChangeEmail ? (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={onChangeEmail}
                activeOpacity={0.7}
                testID="confirm-email-change"
              >
                <Text style={styles.secondaryBtnText}>Wrong email?</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={onClose}
              activeOpacity={0.7}
              testID="confirm-email-close"
            >
              <Text style={styles.secondaryBtnText}>I&apos;ll check now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Tip({
  Icon, title, body,
}: { Icon: typeof Inbox; title: string; body: string }) {
  return (
    <View style={styles.tipRow}>
      <View style={styles.tipIcon}>
        <Icon size={14} color={Colors.textSecondary} strokeWidth={2} />
      </View>
      <View style={styles.tipBody}>
        <Text style={styles.tipTitle}>{title}</Text>
        <Text style={styles.tipText}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  email: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
    marginTop: 4,
    marginBottom: 18,
    textAlign: 'center',
  },
  tips: {
    width: '100%',
    gap: 12,
    marginBottom: 16,
  },
  tipRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  tipIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  tipBody: {
    flex: 1,
  },
  tipTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  tipText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'stretch',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 12,
  },
  statusBannerSuccess: {
    backgroundColor: '#E8F5E9',
  },
  statusBannerError: {
    backgroundColor: Colors.errorLight,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  statusTextSuccess: {
    color: '#1B5E20',
  },
  statusTextError: {
    color: Colors.error,
  },
  primaryBtn: {
    alignSelf: 'stretch',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  secondaryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
});
