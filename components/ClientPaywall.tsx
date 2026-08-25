// components/ClientPaywall.tsx — paywall modal for the property-owner
// persona. Shown when a client tries to post an RFP (one-off fee gate)
// or tries to use a management feature behind the client subscription.
//
// Pricing model (utils/clientPricing.ts): pay $25 per RFP post, OR
// $19/mo Pro / $49/mo Property Manager unlocks unlimited posts +
// post-award management. 14-day free trial.
//
// This modal is the FIRST surface — for this commit the "Pay" and
// "Start trial" buttons grant local credits in AsyncStorage so the
// user can flow through /post-rfp end-to-end. Real Stripe charges +
// RevenueCat client tier ship in a follow-up. The visual + copy is
// production-quality so we can show real users today.

import React, { useCallback, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, ActivityIndicator, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, X, FileText, Home as HomeIcon, Briefcase } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';

import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import {
  CLIENT_PRICING,
  formatClientPrice,
  getRfpPostCreditBalance,
  startClientTrial,
  saveClientSubState,
  type ClientSubscriptionTier,
} from '@/utils/clientPricing';

/** Two flavors of the paywall — the gate code picks which to surface
 *  based on what the user is trying to do. */
export type ClientPaywallMode =
  /** Property owner just tried to post an RFP. Show the one-off fee + the
   *  "or get a subscription" upsell side-by-side. */
  | 'rfp-post'
  /** Property owner tried to use a management feature (milestones, docs,
   *  multi-property dashboard). One-off fee doesn't apply here; show only
   *  the subscription tiers. */
  | 'subscription';

interface ClientPaywallProps {
  visible: boolean;
  mode: ClientPaywallMode;
  /** Display name of the feature being gated, e.g. "Milestone payments".
   *  Surfaced in the eyebrow so the user understands what unlocked the
   *  paywall. */
  feature?: string;
  /** Called when the user dismisses without paying or subscribing. */
  onClose: () => void;
  /** Called after the user successfully grants themselves access.
   *  Receives a tag describing what they bought so the caller can
   *  branch (e.g. consume the one-off credit immediately vs. just
   *  re-checking subscription state). */
  onUnlocked: (via: 'rfp_post_fee' | 'pro_trial' | 'pm_trial') => void;
}

// Kill-switch for the one-off "Pay $X to post" RFP path.
//
// SHIPPED DISABLED (product decision): the per-post CTA below only ever
// recorded a *local* AsyncStorage credit via recordRfpPostCredit() — it
// charged nothing, was trivially bypassable, wiped on logout, and is a
// non-compliant purchase UI. Rather than ship a "Pay $25" button that
// collects $0, we hide the paid path entirely and leave only the
// subscription + free-trial paths live for launch.
//
// TODO(billing): before flipping this back to `true`, wire real,
// server-enforced billing — a Stripe PaymentIntent (Apple/Google Pay on
// native, Payment Link on web) whose *server-confirmed* completion is
// what grants the post credit (see handlePayPerPost placeholder), NOT a
// client-side recordRfpPostCredit() call. Until then this MUST stay false.
const RFP_PAID_POST_ENABLED = false;

const PRO_BENEFITS = [
  'Unlimited project posts',
  'Side-by-side bid comparison',
  'Direct messaging with bidders',
  'Photo updates from your project',
  'Milestone payment scheduling',
  'Document storage (contracts, invoices)',
];

const PM_BENEFITS = [
  'Everything in Pro, plus:',
  'Multi-property dashboard',
  'Team seats for your staff',
  'Bulk-post recurring maintenance jobs',
  'Aggregate spend reporting',
  'Priority support',
];

export default function ClientPaywall({ visible, mode, feature, onClose, onUnlocked }: ClientPaywallProps) {
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [busy, setBusy] = useState<'rfp' | 'pro' | 'pm' | null>(null);

  const handlePayPerPost = useCallback(async () => {
    if (busy) return;
    setBusy('rfp');
    try {
      // Real Stripe Checkout. The credit is granted SERVER-SIDE by the
      // stripe-webhook after the $25 is captured — never client-side — so the
      // fee can't be bypassed. create-rfp-checkout returns a hosted checkout URL.
      const returnUrl = Platform.OS === 'web'
        ? 'https://app.mageid.app/post-rfp'
        : 'mageid://post-rfp';
      const { data, error } = await supabase.functions.invoke('create-rfp-checkout', {
        body: { returnUrl },
      });
      const url = (data as { url?: string } | null)?.url;
      if (error || !url) throw new Error(error?.message ?? 'Could not start checkout');

      if (Platform.OS === 'web') {
        // Hand off to Stripe. We abort the current attempt (onClose resolves the
        // gate false) so nothing posts until payment lands; the webhook grants
        // the credit and the next "Post" tap spends it.
        await Linking.openURL(url);
        onClose();
        return;
      }

      // Native: in-app browser, then wait briefly for the webhook to grant.
      await WebBrowser.openBrowserAsync(url);
      let granted = false;
      for (let i = 0; i < 6; i++) {
        if ((await getRfpPostCreditBalance()) > 0) { granted = true; break; }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (granted) {
        // This path is native-only (web returns above), so haptics run bare.
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onUnlocked('rfp_post_fee');
      } else {
        onClose();
        showAlert(
          'Payment processing',
          'If you completed payment, tap Post again in a moment to publish your project.',
        );
      }
    } catch (err) {
      console.warn('[ClientPaywall] pay-per-post failed:', err);
      showAlert('Checkout unavailable', 'Could not start payment. Please try again.');
    } finally {
      setBusy(null);
    }
  }, [busy, onClose, onUnlocked]);

  const handleStartTrial = useCallback(async (tier: Exclude<ClientSubscriptionTier, 'free'>) => {
    if (busy) return;
    setBusy(tier === 'client_pro' ? 'pro' : 'pm');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      // Placeholder: real implementation enrolls the user in RevenueCat
      // (or a Stripe Customer + subscription with trial_period_days=14).
      // Locally we just stamp the trial start so the rest of the app
      // can branch on hasActiveClientSubscription(...).
      await startClientTrial(tier);
      onUnlocked(tier === 'client_pro' ? 'pro_trial' : 'pm_trial');
    } finally {
      setBusy(null);
    }
  }, [busy, onUnlocked]);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
        {/* Top bar — X dismiss left, eyebrow centered. The eyebrow names
            what they were trying to do so they understand why this
            opened ("To post a project…", "To unlock milestone payments…"). */}
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close paywall"
            style={styles.closeBtn}
            testID="client-paywall-close"
          >
            <X size={22} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>
              {mode === 'rfp-post'
                ? 'To post your project'
                : feature ? `To unlock ${feature}` : 'To manage your project'}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.headline}>
            {mode === 'rfp-post'
              ? (RFP_PAID_POST_ENABLED ? 'Pay per project, or go unlimited' : 'Post unlimited projects')
              : 'Manage your project from one place'}
          </Text>
          <Text style={styles.lede}>
            {mode === 'rfp-post'
              ? (RFP_PAID_POST_ENABLED
                  ? 'Post a single project for a one-time fee, or subscribe to post unlimited projects and manage them all from one dashboard.'
                  : 'Subscribe to post unlimited projects and manage them all from one dashboard, with a free trial.')
              : 'A subscription unlocks milestone payments, document storage, and ongoing management for every project you award.'}
          </Text>

          {/* ── Per-post option (rfp-post mode only) ──────────────────────
              The one-off card is intentionally less prominent than the
              two subscription cards below — same fact pattern as Spotify's
              "pay-per-track vs subscribe" page. Per-post is the right
              answer for a one-and-done renovation; subscription is the
              right answer for anyone with > 1 property. */}
          {mode === 'rfp-post' && RFP_PAID_POST_ENABLED && (
            <View style={styles.perPostCard}>
              <View style={styles.perPostHead}>
                <View style={[styles.iconWrap, { backgroundColor: themeColors.neutralSoft }]}>
                  <FileText size={18} color={themeColors.text} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.perPostTitle}>Pay per project</Text>
                  <Text style={styles.perPostSubtitle}>
                    Best for a single renovation or one-off job
                  </Text>
                </View>
                <Text style={styles.perPostPrice}>
                  {formatClientPrice(CLIENT_PRICING.RFP_POST_FEE_CENTS)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.perPostCta}
                onPress={handlePayPerPost}
                disabled={!!busy}
                activeOpacity={0.85}
                testID="client-paywall-pay-per-post"
              >
                {busy === 'rfp' ? (
                  <ActivityIndicator size="small" color={themeColors.text} />
                ) : (
                  <Text style={styles.perPostCtaText}>
                    Pay {formatClientPrice(CLIENT_PRICING.RFP_POST_FEE_CENTS)} to post
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {mode === 'rfp-post' && RFP_PAID_POST_ENABLED && (
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR SUBSCRIBE</Text>
              <View style={styles.dividerLine} />
            </View>
          )}

          {/* ── Pro tier — individual landlords ──────────────────────────
              The headline subscription option. Branded fill, no border;
              the "Most popular" tag mirrors what every SaaS pricing page
              ships in 2026. 14-day trial framing makes "Start trial"
              feel safe to tap. */}
          <View style={[styles.subCard, styles.subCardFeatured]}>
            <View style={styles.subCardTag}>
              <Text style={styles.subCardTagText}>MOST POPULAR</Text>
            </View>
            <View style={styles.subCardHead}>
              <View style={[styles.iconWrap, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                <HomeIcon size={18} color="#FFF" strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.subCardTitle, { color: '#FFF' }]}>Pro</Text>
                <Text style={[styles.subCardSubtitle, { color: 'rgba(255,255,255,0.78)' }]}>
                  For individual landlords & flippers
                </Text>
              </View>
              <View style={styles.subCardPriceWrap}>
                <Text style={[styles.subCardPrice, { color: '#FFF' }]}>
                  {formatClientPrice(CLIENT_PRICING.CLIENT_PRO_MONTHLY_CENTS)}
                </Text>
                <Text style={[styles.subCardPriceUnit, { color: 'rgba(255,255,255,0.78)' }]}>/ month</Text>
              </View>
            </View>

            <View style={styles.benefitsList}>
              {PRO_BENEFITS.map((b, i) => (
                <View key={i} style={styles.benefitRow}>
                  <CheckCircle2 size={14} color="#FFF" strokeWidth={2.4} />
                  <Text style={[styles.benefitText, { color: '#FFF' }]}>{b}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.subCta, { backgroundColor: '#FFF' }]}
              onPress={() => handleStartTrial('client_pro')}
              disabled={!!busy}
              activeOpacity={0.85}
              testID="client-paywall-pro-trial"
            >
              {busy === 'pro' ? (
                <ActivityIndicator size="small" color={themeColors.accent} />
              ) : (
                <>
                  <MageAIMark size={14} color={themeColors.accent} />
                  <Text style={[styles.subCtaText, { color: themeColors.accent }]}>
                    Start {CLIENT_PRICING.TRIAL_DAYS}-day free trial
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={[styles.trialFinePrint, styles.trialFinePrintOnAccent]}>
              No card required during trial · Cancel anytime
            </Text>
          </View>

          {/* ── Property Manager tier — multi-unit / REIT ─────────────── */}
          <View style={styles.subCard}>
            <View style={styles.subCardHead}>
              <View style={[styles.iconWrap, { backgroundColor: themeColors.accent + '22' }]}>
                <Briefcase size={18} color={themeColors.accent} strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.subCardTitle}>Property Manager</Text>
                <Text style={styles.subCardSubtitle}>
                  For PMs, REITs, and multi-property owners
                </Text>
              </View>
              <View style={styles.subCardPriceWrap}>
                <Text style={styles.subCardPrice}>
                  {formatClientPrice(CLIENT_PRICING.CLIENT_PM_MONTHLY_CENTS)}
                </Text>
                <Text style={styles.subCardPriceUnit}>/ month</Text>
              </View>
            </View>

            <View style={styles.benefitsList}>
              {PM_BENEFITS.map((b, i) => (
                <View key={i} style={styles.benefitRow}>
                  <CheckCircle2 size={14} color={themeColors.accent} strokeWidth={2.4} />
                  <Text style={styles.benefitText}>{b}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.subCta, { backgroundColor: themeColors.accent }]}
              onPress={() => handleStartTrial('client_pm')}
              disabled={!!busy}
              activeOpacity={0.85}
              testID="client-paywall-pm-trial"
            >
              {busy === 'pm' ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <MageAIMark size={14} color="#FFF" />
                  <Text style={[styles.subCtaText, { color: '#FFF' }]}>
                    Start {CLIENT_PRICING.TRIAL_DAYS}-day free trial
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={styles.trialFinePrint}>
              No card required during trial · Cancel anytime
            </Text>
          </View>

          {/* Plain-language reassurance — every SaaS-pricing page in 2026
              has this row. Helps users tap CTA without anxiety. */}
          <Text style={styles.disclosureText}>
            Subscriptions auto-renew after the trial unless cancelled at least 24h
            before renewal. Manage or cancel any time in Settings.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// Expose a tiny utility for the rest of the app to "downgrade" a user
// back to free (e.g. trial expired). Keeps the saveClientSubState import
// surface small for consumers who only need to read state.
export async function downgradeClientToFree(): Promise<void> {
  await saveClientSubState({
    tier: 'free',
    trialEndsAt: null,
    updatedAt: new Date().toISOString(),
  });
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700',
    color: t.textMuted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  headline: {
    fontSize: Type.title1.fontSize,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.6,
    marginTop: 12,
    lineHeight: 36,
  },
  lede: {
    fontSize: Type.subhead.fontSize,
    color: t.textSecondary,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 22,
    maxWidth: 540,
  },

  // ── Per-post card ─────────────────────────────────────────────────
  perPostCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.line,
    padding: 16,
    gap: 12,
  },
  perPostHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  perPostTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.2,
  },
  perPostSubtitle: {
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 17,
  },
  perPostPrice: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.4,
  },
  perPostCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    minHeight: 44,
  },
  perPostCtaText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700',
    color: t.text,
  },

  // ── OR divider ────────────────────────────────────────────────────
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: t.line,
  },
  dividerText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700',
    color: t.textMuted,
    letterSpacing: 1.2,
  },

  // ── Subscription cards ────────────────────────────────────────────
  subCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.line,
    padding: 18,
    marginBottom: 14,
    gap: 14,
  },
  subCardFeatured: {
    backgroundColor: t.accentFill,
    borderColor: t.accent,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 6,
  },
  subCardTag: {
    position: 'absolute',
    top: -10,
    right: 18,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.full,
    backgroundColor: '#FFF',
  },
  subCardTagText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: t.accent,
  },
  subCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  subCardTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.4,
  },
  subCardSubtitle: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '500',
    color: t.textMuted,
    marginTop: 2,
    lineHeight: 17,
  },
  subCardPriceWrap: {
    alignItems: 'flex-end',
  },
  subCardPrice: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.4,
  },
  subCardPriceUnit: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600',
    color: t.textMuted,
    marginTop: -2,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitsList: { gap: 8 },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  benefitText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: t.text,
    fontWeight: '500',
    lineHeight: 19,
  },

  // ── CTAs ──────────────────────────────────────────────────────────
  subCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: Tokens.radius.md,
    minHeight: 48,
  },
  subCtaText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  trialFinePrint: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    textAlign: 'center',
    fontWeight: '600',
    marginTop: -4,
  },
  // Overrides the muted text-on-surface color when the trial copy sits
  // inside the featured (accent-filled) card — cream@78% reads against
  // the orange fill the same way it does in onboarding's eyebrow text.
  trialFinePrintOnAccent: {
    color: 'rgba(255,255,255,0.78)',
  },

  disclosureText: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 18,
    fontWeight: '500',
    maxWidth: 480,
    alignSelf: 'center',
  },
});
