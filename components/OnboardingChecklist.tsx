// OnboardingChecklist — 5-step "do this next" panel on the home screen.
//
// Sits between the auto-opened Tutorial modal (deep dive) and the empty
// state (zero context). The user has just signed up; they need a clear
// list of concrete next actions, not a 19-step modal.
//
// Items reflect competitor research — Linear, Notion, Stripe all use
// progress-tracked checklists for new users because they convert ~3x
// better than a single "Get started" CTA. We track completion via real
// state (project count, has-an-estimate, has-an-invoice, has-an-AI-run)
// — not flags — so the user can't accidentally check things off without
// doing them, and the checklist auto-clears when 4 of 5 are real.
//
// Dismissable: tapping the X persists `mageid_onboarding_checklist_dismissed`
// so the panel never returns. We never re-show even if the user creates
// 5 more projects — once they've earned the right to dismiss, respect it.

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  CheckCircle2, Circle, ArrowRight, X, Sparkles, FolderPlus, Calculator,
  Receipt, Mic, Ruler,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useRouter } from 'expo-router';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const DISMISSED_KEY = 'mageid_onboarding_checklist_dismissed_v1';
/** Hide the panel automatically when at least this many items are done.
 *  4/5 means a user who's run a takeoff + sent an invoice + created a
 *  project + done one of {estimate / voice} stops seeing it without
 *  having to dismiss manually. */
const AUTO_HIDE_AT_DONE = 4;

export interface OnboardingChecklistProps {
  /** Live counts from ProjectContext / state — drives "done" detection. */
  projectCount: number;
  estimateCount: number;
  invoiceCount: number;
  takeoffRun: boolean;
  voiceUsed: boolean;
}

interface ChecklistItem {
  key: 'project' | 'estimate' | 'takeoff' | 'invoice' | 'voice';
  title: string;
  done: boolean;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  href: string;
  cta: string;
}

function OnboardingChecklistImpl({
  projectCount, estimateCount, invoiceCount, takeoffRun, voiceUsed,
}: OnboardingChecklistProps) {
  const router = useRouter();
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
      key: 'project',
      title: 'Create your first project',
      done: projectCount > 0,
      Icon: FolderPlus,
      href: '/?openCreate=1',
      cta: 'Add a project',
    },
    {
      key: 'estimate',
      title: 'Build an estimate',
      done: estimateCount > 0,
      Icon: Calculator,
      href: '/(tabs)/estimate',
      cta: 'Open estimator',
    },
    {
      key: 'takeoff',
      title: 'Run an AI takeoff on a PDF',
      done: takeoffRun,
      Icon: Ruler,
      href: '/takeoff',
      cta: 'Try takeoff',
    },
    {
      key: 'invoice',
      title: 'Send an invoice',
      done: invoiceCount > 0,
      Icon: Receipt,
      href: '/invoice',
      cta: 'New invoice',
    },
    {
      key: 'voice',
      title: 'Try voice — tap any mic icon and talk',
      done: voiceUsed,
      Icon: Mic,
      href: '/(tabs)/(home)',
      cta: 'Got it',
    },
  ], [projectCount, estimateCount, takeoffRun, invoiceCount, voiceUsed]);

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
    if (item.key === 'voice') {
      // No actual destination for "try voice" — the mic is everywhere,
      // they'll find it. Mark it visually-completed by treating the tap
      // as good faith. We don't persist a "voiceUsed" flag from this
      // tap; that comes from the actual VoiceCaptureModal usage signal.
      return;
    }
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
            <Sparkles size={14} color={Colors.primary} />
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
        <TouchableOpacity onPress={handleDismiss} hitSlop={10} style={styles.closeBtn} testID="onboarding-checklist-dismiss" accessibilityRole="button" accessibilityLabel="Close"><X size={14} color={Colors.textMuted} /></TouchableOpacity>
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
                  <CheckCircle2 size={18} color={Colors.success} />
                ) : (
                  <Circle size={18} color={Colors.textMuted} strokeWidth={1.8} />
                )}
                <Icon size={14} color={item.done ? Colors.textMuted : Colors.primary} />
                <Text style={[styles.itemTitle, item.done && styles.itemTitleDone]}>
                  {item.title}
                </Text>
              </View>
              {!item.done && (
                <View style={styles.itemCta}>
                  <Text style={styles.itemCtaText}>{item.cta}</Text>
                  <ArrowRight size={12} color={Colors.primary} />
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
    padding: 14,
    marginHorizontal: Tokens.spacing.md,
    marginBottom: Tokens.spacing.sm,
    gap: 10,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headIcon: {
    width: 28, height: 28, borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.1 },
  subtitle: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline, lineHeight: 15 },
  closeBtn: {
    width: 28, height: 28, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  progressTrack: {
    height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%', backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  list: { gap: 6 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs,
    paddingHorizontal: 10, paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.background,
  },
  itemDone: {
    backgroundColor: Colors.success + '08',
    opacity: 0.85,
  },
  itemLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
  itemTitle: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600', color: Colors.text },
  itemTitleDone: {
    color: Colors.textMuted,
    textDecorationLine: 'line-through' as const,
  },
  itemCta: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs,
    paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs,
    borderRadius: Tokens.radius.xs,
    backgroundColor: Colors.primary + '12',
  },
  itemCtaText: { fontSize: Type.caption2.fontSize, color: Colors.primary, fontWeight: '700' },
});
