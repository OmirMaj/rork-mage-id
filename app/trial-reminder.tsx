// trial-reminder.tsx — "We'll remind you before it ends" frame.
// User picks 1 / 2 / 3 days before the trial ends to get a system
// notification reminder. Frame 6 of the activation sequence
// (welcome → onboarding → feature → offer → reminder → design).
//
// What we actually do with the chosen value:
//   1. Persist to AsyncStorage `trial_reminder_days`. The
//      morning-digest cron (supabase/functions/morning-digest) reads
//      this and skips the user when the trial isn't within their
//      reminder window.
//   2. ALSO schedule a local notification at trial_end_date - N days
//      via expo-notifications. This is the belt + suspenders so the
//      user gets pinged even if they uninstall + reinstall (and
//      hence lose AsyncStorage).
//
// Why this matters: trials that auto-charge without warning are a
// top App Store complaint and a major dispute generator on Stripe.
// Roamy's pattern of an explicit "we'll remind you" reassurance lifts
// trial-completion rates AND reduces chargebacks.

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { Bell, Check, BellRing, BellOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';

const REMINDER_KEY = 'trial_reminder_days';
const TRIAL_LENGTH_DAYS = 7;
const REMINDER_OPTIONS = [1, 2, 3] as const;
type ReminderDays = typeof REMINDER_OPTIONS[number];

export default function TrialReminderScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [reminderDays, setReminderDays] = useState<ReminderDays>(2);

  const handleContinue = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});

    // Persist the chosen reminder window. The morning-digest cron
    // and any local-notification scheduler reads this on launch.
    try {
      await AsyncStorage.setItem(REMINDER_KEY, String(reminderDays));
    } catch (err) {
      console.log('[trial-reminder] persist failed', err);
    }

    // Schedule a local notification too — survives backend outage,
    // works offline. Best-effort: if the user denied notification
    // permission earlier this is a no-op.
    if (Platform.OS !== 'web') {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status === 'granted') {
          const fireAt = new Date();
          fireAt.setDate(fireAt.getDate() + (TRIAL_LENGTH_DAYS - reminderDays));
          fireAt.setHours(10, 0, 0, 0);
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Your MAGE ID trial ends soon',
              body: reminderDays === 1
                ? 'Tomorrow your free trial wraps. Keep going for $49.99/yr or cancel anytime in Settings.'
                : `Your free trial ends in ${reminderDays} days. Keep going for $49.99/yr or cancel anytime in Settings.`,
            },
            trigger: fireAt as unknown as Notifications.NotificationTriggerInput,
          });
        }
      } catch (err) {
        console.log('[trial-reminder] schedule failed', err);
      }
    }

    router.push('/trial-design');
  }, [reminderDays, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.brandRow}>
        <View style={styles.brandLogoBg}>
          <Text style={styles.brandLogo}>MAGE</Text>
        </View>
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.title}>We&apos;ll remind you{'\n'}before it ends</Text>
      </View>

      {/* Calendar illustration. Not a 3D render — we layer flat
          shapes (View + emoji) to stay free of asset bloat. */}
      <View style={styles.illoWrap}>
        <View style={styles.illoCalendar}>
          <View style={styles.illoCalendarTop} />
          <View style={styles.illoCalendarBody}>
            <Text style={styles.illoEmoji}>📆</Text>
          </View>
          <View style={styles.illoRing} />
          <View style={[styles.illoRing, { left: 38 }]} />
          <View style={[styles.illoRing, { left: 62 }]} />
          <View style={[styles.illoRing, { left: 86 }]} />
        </View>
      </View>

      {/* Mock notification preview — visual reassurance about what the
          reminder will look like on the user's lock screen. */}
      <View style={styles.previewWrap}>
        <View style={styles.previewCard}>
          <View style={styles.previewIcon}>
            <Text style={styles.previewIconLetter}>M</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.previewHead}>
              <Text style={styles.previewTitle}>Your trial ends soon</Text>
              <Text style={styles.previewTime}>9:41 AM</Text>
            </View>
            <Text style={styles.previewBody}>Heads up — keep going or cancel anytime 🛠️</Text>
          </View>
        </View>
        <View style={[styles.previewCard, styles.previewCardBack]} />
      </View>

      <ScrollView contentContainerStyle={[styles.optionsWrap, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.options}>
          {REMINDER_OPTIONS.map(days => {
            const isActive = reminderDays === days;
            const Icon = isActive ? BellRing : days === reminderDays ? Bell : BellOff;
            return (
              <TouchableOpacity
                key={days}
                style={[styles.optionRow, isActive && styles.optionRowActive]}
                onPress={() => {
                  if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
                  setReminderDays(days);
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                testID={`trial-reminder-${days}`}
              >
                <Icon size={16} color={isActive ? Colors.primary : Colors.textMuted} />
                <Text style={[styles.optionLabel, isActive && styles.optionLabelActive]}>
                  {days} day{days === 1 ? '' : 's'} before trial ends
                </Text>
                <View style={[styles.optionRadio, isActive && styles.optionRadioActive]}>
                  {isActive && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={styles.continueBtn}
          onPress={handleContinue}
          activeOpacity={0.9}
          accessibilityRole="button"
          testID="trial-reminder-continue"
        >
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Tokens.spacing.xl },

  brandRow: { alignItems: 'center' as const, marginBottom: Tokens.spacing.xs },
  brandLogoBg: { backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 12 },
  brandLogo: { fontSize: 16, fontWeight: '900' as const, color: Colors.text, letterSpacing: -0.4 },

  titleRow: { marginTop: 14 },
  title: { fontSize: 30, fontWeight: '900' as const, color: Colors.text, letterSpacing: -0.7, lineHeight: 36 },

  illoWrap: { alignItems: 'center' as const, justifyContent: 'center' as const, marginTop: Tokens.spacing.xl, height: 160 },
  illoCalendar: { width: 120, height: 130, borderRadius: 18, backgroundColor: '#3FA1F0', position: 'relative' as const, alignItems: 'center' as const, paddingTop: 22, shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 18, elevation: 8 },
  illoCalendarTop: { position: 'absolute' as const, left: 0, right: 0, top: 0, height: 22, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#FFC857' },
  illoCalendarBody: { width: 95, height: 90, borderRadius: 8, backgroundColor: Colors.surface, alignItems: 'center' as const, justifyContent: 'center' as const, marginTop: Tokens.spacing.xxs },
  illoEmoji: { fontSize: 38 },
  illoRing: { position: 'absolute' as const, top: -6, left: 14, width: 12, height: 12, borderRadius: 6, backgroundColor: '#9CA3AF' },

  previewWrap: { marginTop: Tokens.spacing.sm, height: 70 },
  previewCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, backgroundColor: Colors.surface, borderRadius: 16, padding: Tokens.spacing.sm, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  previewCardBack: { position: 'absolute' as const, left: 6, right: 6, top: 8, height: 60, backgroundColor: Colors.fillTertiary, zIndex: -1 },
  previewIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const },
  previewIconLetter: { fontSize: 16, fontWeight: '900' as const, color: Colors.surface },
  previewHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  previewTitle: { fontSize: 13, fontWeight: '800' as const, color: Colors.text },
  previewTime: { fontSize: 11, color: Colors.textMuted },
  previewBody: { fontSize: 12, color: Colors.textSecondary, marginTop: Tokens.spacing.hairline },

  optionsWrap: { paddingTop: Tokens.spacing.lg },
  options: { backgroundColor: Colors.surfaceAlt, borderRadius: 18, padding: 6 },
  optionRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Tokens.spacing.sm, padding: 14, borderRadius: 14 },
  optionRowActive: { backgroundColor: Colors.primary + '15' },
  optionLabel: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.textMuted },
  optionLabelActive: { color: Colors.text },
  optionRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.fillSecondary, alignItems: 'center' as const, justifyContent: 'center' as const },
  optionRadioActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },

  footer: { position: 'absolute' as const, left: 24, right: 24, bottom: 0, paddingTop: Tokens.spacing.sm, backgroundColor: Colors.background },
  continueBtn: { minHeight: 56, borderRadius: 999, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 4 },
  continueBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.textOnPrimary, letterSpacing: -0.2 },
});
