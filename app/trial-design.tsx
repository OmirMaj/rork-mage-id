// trial-design.tsx — "Design your trial" timeline screen.
// Frame 7 (final) of the activation sequence (welcome → onboarding →
// feature → offer → reminder → design).
//
// Visual model: a 3-stop timeline (Today / In 5 days / In 7 days)
// showing exactly what happens and when, then two trial options
// (7-day free vs. paid trial), then a single Redeem CTA.
//
// Why this beats the existing app/onboarding-paywall.tsx for first-
// run trial conversion:
//   1. Honest. Every dispute / chargeback / 1-star App Store review
//      that includes "I didn't know I'd be charged" gets refuted by
//      this screen's 3-stop visualization. It's the same pattern
//      Notion, Calm, Headspace, Roamy all run.
//   2. Single CTA. No "see all plans" maze; the user picks 7-day
//      free OR 30-day paid trial AND hits the redeem button. Anyone
//      who wants to compare tiers does so post-trial in Settings.
//
// Plumbing:
//   - The 7-day trial uses the existing `purchasePro('annual')` call
//     when the underlying RC product has a 7-day free trial configured
//     in App Store Connect / Play Console (which it does — the
//     `com.mageid.pro.annual` product is set up that way).
//   - The 30-day "paid trial" is currently surfaced as a teaser; the
//     SKU for it isn't yet in App Store Connect. When the GC adds
//     `com.mageid.pro.intro30` with $3.99 intro price, swap the
//     handler. Today the row is selectable but explains "coming
//     soon" if tapped without the SKU available.
//   - On purchase success, RevenueCat fires the customerInfo listener
//     which lifts `tier` to 'pro'; the existing _layout gate then
//     redirects to home.

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform,
  Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Unlock, Bell, Crown, X, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Type } from '@/constants/typography';

type TrialOption = '7-day' | '30-day';

const TRIAL_LENGTH_DAYS = 7;

export default function TrialDesignScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { purchasePro, restorePurchases } = useSubscription();
  const [selected, setSelected] = useState<TrialOption>('7-day');
  const [purchasing, setPurchasing] = useState(false);

  // Compute the billing date the timeline references — exactly
  // TRIAL_LENGTH_DAYS from now, formatted for the user's locale.
  const billingDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + TRIAL_LENGTH_DAYS);
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  })();

  const handleRedeem = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    if (selected === '30-day') {
      Alert.alert(
        '30-day trial coming soon',
        'The $3.99 / 30-day option is on the roadmap; for now only the 7-day free trial is live. Switch to 7-Days Trial to redeem.',
      );
      return;
    }

    setPurchasing(true);
    try {
      // The annual Pro product on RC has a 7-day intro free trial
      // configured. Calling purchasePackage on it kicks off that
      // trial via StoreKit / Play Billing — no money charged today.
      await purchasePro('annual');
      // Auth gate in _layout redirects to /(tabs)/(home) once tier
      // flips to 'pro'.
    } catch (err) {
      Alert.alert(
        'Could not start trial',
        err instanceof Error ? err.message : 'Try again, or restore purchases if you already have a subscription.',
      );
    } finally {
      setPurchasing(false);
    }
  }, [selected, purchasePro]);

  const handleSkip = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    // No-trial path — drop straight to home on free tier. The user
    // can re-enter the trial flow from Settings → Plan.
    router.replace('/(tabs)/(home)' as never);
  }, [router]);

  const handleRestore = useCallback(async () => {
    try {
      await restorePurchases();
    } catch (err) {
      Alert.alert('Restore failed', err instanceof Error ? err.message : 'No prior purchases on this Apple ID.');
    }
  }, [restorePurchases]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.headerRow}>
        <View style={styles.brandLogoBg}>
          <Text style={styles.brandLogo}>MAGE</Text>
        </View>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={handleSkip} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close" testID="trial-design-skip">
          <X size={18} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 220 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Design your trial</Text>

        {/* Three-stop timeline. Each stop has a colored dot icon, a
            heading, and a one-line description. The vertical rail
            between stops is a thin line that visually connects them. */}
        <View style={styles.timeline}>
          <TimelineStop
            iconBg="#22C55E"
            Icon={Unlock}
            title="Today"
            body="Unlock everything — projects, schedule, AI takeoff, daily reports, sub portal, payments. No limits."
            isFirst
          />
          <TimelineStop
            iconBg="#FB923C"
            Icon={Bell}
            title="In 5 days — Reminder"
            body="We send you a heads-up that your trial wraps in 2 days. Cancel anytime in Settings → Plan."
          />
          <TimelineStop
            iconBg="#3FA1F0"
            Icon={Crown}
            title="In 7 days — Billing starts"
            body={`You'll be charged on ${billingDate} unless you cancel anytime before.`}
            isLast
          />
        </View>

        <View style={styles.optionsWrap}>
          <TouchableOpacity
            style={[styles.optionCard, selected === '7-day' && styles.optionCardActive]}
            onPress={() => { setSelected('7-day'); if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {}); }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === '7-day' }}
            testID="trial-7day"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>7-Days Trial</Text>
              <Text style={styles.optionSub}>Free for 7 days</Text>
            </View>
            <View style={[styles.optionRadio, selected === '7-day' && styles.optionRadioActive]}>
              {selected === '7-day' && <Check size={14} color="#FFFFFF" strokeWidth={3} />}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.optionCard, selected === '30-day' && styles.optionCardActive]}
            onPress={() => { setSelected('30-day'); if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {}); }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === '30-day' }}
            testID="trial-30day"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>30-Days Trial</Text>
              <Text style={styles.optionSub}>$3.99 for 30 days · coming soon</Text>
            </View>
            <View style={[styles.optionRadio, selected === '30-day' && styles.optionRadioActive]}>
              {selected === '30-day' && <Check size={14} color="#FFFFFF" strokeWidth={3} />}
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={handleRestore} style={styles.restoreLink} accessibilityRole="link">
          <Text style={styles.restoreLinkText}>Already a subscriber? Restore purchases</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Sticky redeem footer — visible across scroll. Mirrors
          Roamy's persistent CTA at the bottom of the trial-design
          screen. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
        <TouchableOpacity
          style={styles.redeemBtn}
          onPress={handleRedeem}
          disabled={purchasing}
          activeOpacity={0.9}
          accessibilityRole="button"
          testID="trial-design-redeem"
        >
          {purchasing
            ? <ActivityIndicator color={Colors.textOnPrimary} />
            : <Text style={styles.redeemBtnText}>
                {selected === '7-day' ? 'Redeem 7 days for $0.00' : 'Start 30-day trial'}
              </Text>}
        </TouchableOpacity>
        <Text style={styles.redeemSub}>
          7 days free, then $49.99/year · Cancel anytime
        </Text>
      </View>
    </View>
  );
}

function TimelineStop({
  iconBg, Icon, title, body, isFirst, isLast,
}: {
  iconBg: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
  title: string;
  body: string;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  return (
    <View style={styles.stopRow}>
      <View style={styles.stopIconCol}>
        <View style={[styles.stopIcon, { backgroundColor: iconBg }]}>
          <Icon size={16} color="#FFFFFF" />
        </View>
        {!isLast && <View style={[styles.stopRail, isFirst && { top: 32 }]} />}
      </View>
      <View style={styles.stopBody}>
        <Text style={styles.stopTitle}>{title}</Text>
        <Text style={styles.stopText}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Tokens.spacing.lg },

  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, marginBottom: Tokens.spacing.md },
  brandLogoBg: { backgroundColor: Colors.surfaceAlt, paddingHorizontal: Tokens.spacing.sm, paddingVertical: 6, borderRadius: 10 },
  brandLogo: { fontSize: 14, fontWeight: '900' as const, color: Colors.text, letterSpacing: -0.4 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },

  title: { fontSize: 36, fontWeight: '900' as const, color: Colors.text, letterSpacing: -1, marginBottom: Tokens.spacing.xl },

  timeline: { gap: 0, marginBottom: Tokens.spacing.md },
  stopRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 14 },
  stopIconCol: { width: 32, alignItems: 'center' as const },
  stopIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const, zIndex: 2 },
  stopRail: { position: 'absolute' as const, top: 32, bottom: -16, width: 3, backgroundColor: Colors.fillTertiary, alignSelf: 'center' as const, borderRadius: 2 },
  stopBody: { flex: 1, paddingBottom: 22, paddingTop: Tokens.spacing.xxs },
  stopTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '900' as const, color: Colors.text, letterSpacing: -0.3 },
  stopText: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, lineHeight: 19, marginTop: Tokens.spacing.xxs },

  optionsWrap: { gap: 10, marginTop: 10 },
  optionCard: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: Tokens.spacing.sm,
    padding: Tokens.spacing.md, borderRadius: 18, backgroundColor: Colors.surface,
    borderWidth: 1.5, borderColor: Colors.borderLight,
  },
  optionCardActive: { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
  optionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '900' as const, color: Colors.text },
  optionSub: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },
  optionRadio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: Colors.fillSecondary, alignItems: 'center' as const, justifyContent: 'center' as const },
  optionRadioActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },

  restoreLink: { paddingVertical: 14, alignItems: 'center' as const },
  restoreLinkText: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, fontWeight: '600' as const, textDecorationLine: 'underline' as const },

  footer: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.background,
    borderTopWidth: 1, borderTopColor: Colors.borderLight,
    paddingHorizontal: Tokens.spacing.lg, paddingTop: 14,
    alignItems: 'center' as const, gap: Tokens.spacing.xs,
  },
  redeemBtn: { width: '100%', minHeight: 56, borderRadius: 999, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 4 },
  redeemBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.textOnPrimary, letterSpacing: -0.2 },
  redeemSub: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, fontWeight: '600' as const },
});
