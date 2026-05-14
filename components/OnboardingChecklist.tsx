// OnboardingChecklist — "do this next" panel on the home screen.
//
// V2 (May 2026): items rebuilt around the canonical first-week activation
// journey from the strategic audit: company info → first project → first
// estimate → Stripe Connect → first invoice. Pre-V2 the items mixed user
// workflows ("create project", "send invoice") with feature trials ("try
// voice", "run takeoff") which the audit identified as a dilution of the
// activation funnel. Houzz Pro / Buildertrend / JobTread all use a 5-6
// step "core revenue workflow" checklist; this matches that pattern.
//
// Dismissed-key version bumped to v2 so any users who dismissed v1 see
// the new list — by the time they need v2 (Stripe Connect proactive
// nudge), the user-facing reason has shifted.
//
// Why these five and not others:
//   1. Company info  — required for any PDF / email to look legit
//   2. First project — universal activation event across construction SaaS
//   3. First estimate — first piece of value the AI delivers
//   4. Stripe Connect — Houzz Pro, Buildertrend bundle this in onboarding;
//                      we previously deferred it until the GC hit an
//                      invoice "send" wall, which was the #1 friction
//                      point in the audit
//   5. First invoice — the actual business outcome
//
// Items reflect competitor research — Linear, Notion, Stripe all use
// progress-tracked checklists for new users because they convert ~3x
// better than a single "Get started" CTA. We track completion via real
// state (settings.branding filled? project count? stripe connected?
// estimate count? invoice count?) — not flags — so the user can't
// accidentally check things off, and the checklist auto-clears when
// 4 of 5 are real.

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  CheckCircle2, Circle, ArrowRight, X, Sparkles, FolderPlus, Calculator,
  Receipt, Building2, Wallet,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useRouter } from 'expo-router';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const DISMISSED_KEY = 'mageid_onboarding_checklist_dismissed_v2';
/** Hide the panel automatically when at least this many items are done.
 *  4/5 means a user who's run a takeoff + sent an invoice + created a
 *  project + done one of {estimate / voice} stops seeing it without
 *  having to dismiss manually. */
const AUTO_HIDE_AT_DONE = 4;

export interface OnboardingChecklistProps {
  /** Live state from ProjectContext + settings + Stripe status — drives
   *  "done" detection. Each prop maps to one of the 5 canonical activation
   *  events: see file header for the rationale. */
  companyInfoDone: boolean;
  projectCount: number;
  estimateCount: number;
  stripeConnected: boolean;
  invoiceCount: number;
}

interface ChecklistItem {
  key: 'companyInfo' | 'project' | 'estimate' | 'stripe' | 'invoice';
  title: string;
  done: boolean;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  href: string;
  cta: string;
}

function OnboardingChecklistImpl({
  companyInfoDone, projectCount, estimateCount, stripeConnected, invoiceCount,
}: OnboardingChecklistProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const enter = useState(() => new Animated.Value(0))[0];

  // Check the dismissed flag once on mount. We render null until we know
  // — flashing the panel for 50ms then yanking it would be jarring.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(DISMISSED_KEY);
        if (!cancelled) setDismissed(v === '1');
      } catch {
        if (!cancelled) setDismissed(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (dismissed === false) {
      Animated.timing(enter, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [dismissed, enter]);

  const items: ChecklistItem[] = useMemo(() => [
    {
      key: 'companyInfo',
      title: 'Add your company info',
      done: companyInfoDone,
      Icon: Building2,
      href: '/company-profile',
      cta: 'Add info',
    },
    {
      key: 'project',
      title: 'Create your first project',
      done: projectCount > 0,
      Icon: FolderPlus,
      href: '/?openCreate=1',
      cta: 'Add a project',
    },
    {
      key: 'estimate',
      title: 'Build your first estimate',
      done: estimateCount > 0,
      Icon: Calculator,
      href: '/estimate-wizard',
      cta: 'Quick estimate',
    },
    {
      key: 'stripe',
      title: 'Connect Stripe to get paid',
      done: stripeConnected,
      Icon: Wallet,
      href: '/payments-setup',
      cta: 'Connect',
    },
    {
      key: 'invoice',
      title: 'Send your first invoice',
      done: invoiceCount > 0,
      Icon: Receipt,
      href: '/invoice',
      cta: 'New invoice',
    },
  ], [companyInfoDone, projectCount, estimateCount, stripeConnected, invoiceCount]);

  const doneCount = items.filter(i => i.done).length;
  const total = items.length;
  const progress = doneCount / total;

  const handleDismiss = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    Animated.timing(enter, {
      toValue: 0,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(async () => {
      try { await AsyncStorage.setItem(DISMISSED_KEY, '1'); } catch {}
      setDismissed(true);
    });
  }, [enter]);

  const handleTap = useCallback((item: ChecklistItem) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push(item.href as never);
  }, [router]);

  // Hide cases:
  //   - waiting on dismissed-flag read
  //   - user explicitly dismissed
  //   - user has done enough items that the panel has earned its retirement
  if (dismissed !== false) return null;
  if (doneCount >= AUTO_HIDE_AT_DONE) return null;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
    >
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <View style={styles.headIcon}>
            <Sparkles size={14} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Get up and running</Text>
            <Text style={styles.subtitle}>
              {doneCount === 0
                ? '5 quick steps. About 2 minutes.'
                : `${doneCount} of ${total} done — keep going.`}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleDismiss} hitSlop={10} style={styles.closeBtn} testID="onboarding-checklist-dismiss" accessibilityRole="button" accessibilityLabel="Close"><X size={14} color={colors.textMuted} /></TouchableOpacity>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      <View style={styles.list}>
        {items.map(item => {
          const Icon = item.Icon;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.item, item.done && styles.itemDone]}
              onPress={() => handleTap(item)}
              activeOpacity={0.85}
              testID={`onboarding-checklist-${item.key}`}
            >
              <View style={styles.itemLeft}>
                {item.done ? (
                  <CheckCircle2 size={18} color={colors.success} />
                ) : (
                  <Circle size={18} color={colors.textMuted} strokeWidth={1.8} />
                )}
                <Icon size={14} color={item.done ? colors.textMuted : colors.accent} />
                <Text style={[styles.itemTitle, item.done && styles.itemTitleDone]}>
                  {item.title}
                </Text>
              </View>
              {!item.done && (
                <View style={styles.itemCta}>
                  <Text style={styles.itemCtaText}>{item.cta}</Text>
                  <ArrowRight size={12} color={colors.accent} />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
}

export const OnboardingChecklist = memo(OnboardingChecklistImpl);

/** Ask whether the panel has been dismissed. Used elsewhere if we want to
 *  surface a "redo onboarding" link in Settings. */
export async function hasDismissedOnboarding(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(DISMISSED_KEY)) === '1'; }
  catch { return false; }
}

/** Clear the dismissed flag — Settings → "Show onboarding checklist again". */
export async function resetOnboardingDismissed(): Promise<void> {
  try { await AsyncStorage.removeItem(DISMISSED_KEY); } catch {}
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.accent + '40',
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 10,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  head: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  headLeft: { flex: 1, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  headIcon: {
    width: 28, height: 28, borderRadius: Tokens.radius.sm,
    backgroundColor: t.accentSoft,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  title: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.1 },
  subtitle: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 15 },
  closeBtn: {
    width: 28, height: 28, borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: t.surfaceAlt,
  },
  progressTrack: {
    height: 4, borderRadius: 2,
    backgroundColor: t.line,
    overflow: 'hidden' as const,
  },
  progressFill: {
    height: '100%' as const, backgroundColor: t.accent,
    borderRadius: 2,
  },
  list: { gap: 6 },
  item: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingHorizontal: 10, paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
  },
  itemDone: {
    backgroundColor: t.successSoft,
    opacity: 0.85,
  },
  itemLeft: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  itemTitle: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  itemTitleDone: {
    color: t.textMuted,
    textDecorationLine: 'line-through' as const,
  },
  itemCta: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
    backgroundColor: t.accentSoft,
  },
  itemCtaText: { fontSize: Type.caption2.fontSize, color: t.accentLabel, fontWeight: '700' as const },
});
