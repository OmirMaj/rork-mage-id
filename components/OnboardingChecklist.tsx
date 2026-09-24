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
  CheckCircle2, Circle, ArrowRight, X, FolderPlus,
  Receipt, Building2, Wallet, Mic,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useRouter } from 'expo-router';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { getFreeTrialsRemaining } from '@/utils/aiRateLimiter';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { checklistShowMe, type ChecklistShowMe } from '@/utils/tutorial/entryPoints';
import { TUTORIAL_PRACTICE_PASS } from '@/utils/tutorial/practicePass';
import { isFieldOnlyUser } from '@/utils/tutorial/sandboxCore';
import { useTutorialProgress } from '@/utils/tutorial/progress';
import { startTutorial } from '@/utils/tutorial/store';
import { track, AnalyticsEvents } from '@/utils/analytics';

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
  /** true / false once connect-status has ANSWERED; undefined while it has
   *  not (loading, or every read so far failed — offline on site). Unknown is
   *  shown as a neutral "Checking…" row: a failed check is not "not connected"
   *  (audit wave 5, #153), and a step he finished must never un-tick because
   *  the network dropped. */
  stripeConnected: boolean | undefined;
  /** Still unknown AND every retry has failed, nothing fetching now (offline
   *  all session, or connect-status answering 500). "Checking…" would claim
   *  work that has stopped, so the row says the check failed and how to rerun
   *  it — still never "not connected", never un-ticked. */
  stripeCheckFailed?: boolean;
  invoiceCount: number;
  /** True once the user has used any metered-free wow feature (voice,
   *  takeoff, or produced an estimate). Drives the value-first "Try it" step. */
  triedWowFeature: boolean;
}

/** Home's pull-to-refresh re-asks Stripe (app/(tabs)/(home)/index.tsx handleRefresh). */
export const STRIPE_CHECK_FAILED_LABEL = "Couldn't check Stripe — pull down to refresh";

interface ChecklistItem {
  key: 'tryit' | 'companyInfo' | 'project' | 'estimate' | 'stripe' | 'invoice';
  title: string;
  done: boolean;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  href: string;
  cta: string;
  /** Right-side count shown before the CTA — e.g. how many free AI estimates
   *  are left on "Try it". A metered offer that never shows its meter is an
   *  ambush when it runs out. */
  meta?: string;
  /** Set when the step cannot be done yet. The row goes untappable and says
   *  why, rather than sending the user to a screen that dead-ends on him. */
  heldReason?: string;
  /** Set when the app does not KNOW yet whether the step is done. The row is
   *  neither ticked nor offered — it says so and waits. */
  pendingLabel?: string;
  /** The pending row is waiting on a check that is still running (a11y busy);
   *  false for a check that has given up. */
  pendingBusy?: boolean;
}

function OnboardingChecklistImpl({
  companyInfoDone, projectCount, estimateCount, stripeConnected, stripeCheckFailed, invoiceCount, triedWowFeature,
}: OnboardingChecklistProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { tier } = useSubscription();
  // Learn-by-doing: 'Show me first' under the Try-it and first-invoice rows
  // practises the step on a sample job. It NEVER ticks the row — the ticks
  // stay real-state only (practising is not doing).
  const { projects, userRole } = useProjects();
  const { user } = useAuth();
  const { canAccess } = useTierAccess();
  const { progress: tutorialProgress } = useTutorialProgress();
  const fieldOnly = useMemo(() => isFieldOnlyUser(projects, user?.id ?? null), [projects, user?.id]);
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  // Free gets TWO AI estimates for life. The row that spends them is labelled
  // "Try it free" and never said how many were left, so the meter only became
  // visible at zero — from the user's side, an ambush. Read-only: this counts,
  // it never spends.
  const [freeEstimatesLeft, setFreeEstimatesLeft] = useState<number | null>(null);
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
    let cancelled = false;
    (async () => {
      if (tier !== 'free') { setFreeEstimatesLeft(null); return; }
      try {
        const left = await getFreeTrialsRemaining('aiEstimateWizard');
        if (!cancelled) setFreeEstimatesLeft(left);
      } catch { /* no badge is fine; a failed read must not hide the row */ }
    })();
    return () => { cancelled = true; };
  }, [tier]);

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
      key: 'tryit',
      title: 'Try it: voice capture or an AI estimate',
      done: triedWowFeature || estimateCount > 0,
      Icon: Mic,
      href: '/estimate-wizard',
      cta: 'Try it free',
      // Named precisely, because this row offers TWO metered things and only
      // one of them is counted here: voice capture has its own allowance.
      meta: freeEstimatesLeft === null ? undefined
        : freeEstimatesLeft === 0 ? 'AI estimates used up'
        : freeEstimatesLeft === 1 ? '1 AI estimate left'
        : `${freeEstimatesLeft} AI estimates left`,
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
      key: 'companyInfo',
      title: 'Add your company info',
      done: companyInfoDone,
      Icon: Building2,
      href: '/company-profile',
      cta: 'Add info',
    },
    {
      key: 'stripe',
      title: 'Connect Stripe to get paid',
      done: stripeConnected === true,
      Icon: Wallet,
      href: '/payments-setup',
      cta: 'Connect',
      pendingLabel: stripeConnected === undefined
        ? (stripeCheckFailed ? STRIPE_CHECK_FAILED_LABEL : 'Checking…')
        : undefined,
      pendingBusy: stripeConnected === undefined && !stripeCheckFailed,
    },
    {
      key: 'invoice',
      title: 'Send your first invoice',
      // Never 'done' while the row is held (audit wave 5, #155): a held row
      // says the step can't be done yet, so a tick beside it would be a
      // contradiction — seeded sample invoices used to produce exactly that.
      done: invoiceCount > 0 && projectCount > 0,
      Icon: Receipt,
      href: '/invoice',
      cta: 'New invoice',
      // Invoices live inside a project — /invoice renders "No projects yet" for
      // an account with none. Handing a brand-new user a tappable "New invoice"
      // that lands on that is a step which cannot be done in the order given.
      heldReason: projectCount === 0 ? 'after your first project' : undefined,
    },
  ], [triedWowFeature, companyInfoDone, projectCount, estimateCount, stripeConnected, stripeCheckFailed, invoiceCount, freeEstimatesLeft]);

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

  const showMeFor = useCallback((item: ChecklistItem): ChecklistShowMe | null => checklistShowMe(item.key, {
    done: item.done,
    persona: userRole,
    fieldOnly,
    progress: tutorialProgress,
    canAccess,
    practicePass: TUTORIAL_PRACTICE_PASS,
  }), [userRole, fieldOnly, tutorialProgress, canAccess]);

  // tutorial_offered {entry: 'checklist'} — the denominator of the
  // offered → started funnel for this door (spec §13). Once per tutorial per
  // mount, and only while the panel is actually on screen (the same hide
  // rules as the render below).
  const offeredRef = React.useRef<Set<string>>(new Set());
  const checklistVisible = dismissed === false && doneCount < AUTO_HIDE_AT_DONE;
  const offeredIds = useMemo(() => {
    if (!checklistVisible) return [] as string[];
    const out: string[] = [];
    for (const item of items) {
      const m = showMeFor(item);
      if (m?.kind === 'offer') out.push(m.tutorialId);
    }
    return out;
  }, [checklistVisible, items, showMeFor]);
  useEffect(() => {
    for (const id of offeredIds) {
      if (offeredRef.current.has(id)) continue;
      offeredRef.current.add(id);
      track(AnalyticsEvents.TUTORIAL_OFFERED, { tutorial_id: id, entry: 'checklist' });
    }
  }, [offeredIds]);

  const handleShowMe = useCallback((offer: ChecklistShowMe) => {
    if (offer.kind !== 'offer') return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    void startTutorial(offer.tutorialId, { entry: 'checklist' });
  }, []);

  const handleTap = useCallback((item: ChecklistItem) => {
    if (item.heldReason || item.pendingLabel) return;
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
            <MageAIMark size={14} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Get up and running</Text>
            {/* "About 2 minutes" was false for a list whose fourth step is
                Stripe's identity check — /payments-setup's own screen says the
                review takes "an hour, sometimes a few minutes". Promise the
                part we control. */}
            <Text style={styles.subtitle}>
              {doneCount === 0
                ? '5 steps. The first three take about two minutes; Stripe takes longer.'
                : `${doneCount} of ${total} done — keep going.`}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleDismiss} hitSlop={10} style={styles.closeBtn} testID="onboarding-checklist-dismiss" accessibilityRole="button" accessibilityLabel="Close"><X size={14} color={colors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      <View style={styles.list}>
        {items.map(item => {
          const Icon = item.Icon;
          const inert = !!item.heldReason || !!item.pendingLabel;
          const showMe = showMeFor(item);
          return (
            <React.Fragment key={item.key}>
            <TouchableOpacity
              style={[styles.item, item.done && styles.itemDone, !!item.heldReason && styles.itemHeld]}
              onPress={() => handleTap(item)}
              activeOpacity={inert ? 1 : 0.85}
              disabled={inert}
              accessibilityState={{ disabled: inert, busy: !!item.pendingBusy }}
              accessibilityLabel={item.pendingLabel ? `${item.title}. ${item.pendingLabel}` : undefined}
              testID={`onboarding-checklist-${item.key}`}
            >
              <View style={styles.itemLeft}>
                {item.done ? (
                  <CheckCircle2 size={18} color={colors.success} strokeWidth={1.75} />
                ) : (
                  <Circle size={18} color={colors.textMuted} strokeWidth={1.8} />
                )}
                <Icon size={14} color={item.done ? colors.textMuted : colors.accent} />
                <Text style={[styles.itemTitle, item.done && styles.itemTitleDone]}>
                  {item.title}
                </Text>
              </View>
              {!item.done && (
                item.pendingLabel ? (
                  <Text style={styles.itemHeldText} testID={`onboarding-checklist-${item.key}-pending`}>{item.pendingLabel}</Text>
                ) : item.heldReason ? (
                  <Text style={styles.itemHeldText}>{item.heldReason}</Text>
                ) : (
                  <View style={styles.itemCta}>
                    {item.meta ? <Text style={styles.itemMetaText}>{item.meta}</Text> : null}
                    <Text style={styles.itemCtaText}>{item.cta}</Text>
                    <ArrowRight size={12} color={colors.accent} strokeWidth={1.75} />
                  </View>
                )
              )}
            </TouchableOpacity>
            {showMe ? (
              showMe.kind === 'practised' ? (
                <Text style={styles.showMePractised} testID={`onboarding-checklist-${item.key}-practised`}>
                  Practised on the sample
                </Text>
              ) : (
                // A sibling, not nested in the row: a button inside a button is
                // one control to VoiceOver and two <button>s on the web.
                <TouchableOpacity
                  style={styles.showMe}
                  onPress={() => handleShowMe(showMe)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${showMe.label} — practise on a sample job`}
                  testID={`onboarding-checklist-${item.key}-show-me`}
                >
                  <Text style={styles.showMeText}>{showMe.label}</Text>
                </TouchableOpacity>
              )
            ) : null}
            </React.Fragment>
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
  itemMetaText: { fontSize: Type.caption2.fontSize, color: t.accentLabel, fontWeight: '600' as const, opacity: 0.8 },
  itemHeld: { opacity: 0.7 },
  itemHeldText: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const },
  showMe: {
    alignSelf: 'flex-start' as const,
    marginLeft: 36,
    marginTop: -2,
    minHeight: Tokens.touchTarget.min,
    justifyContent: 'center' as const,
  },
  showMeText: { fontSize: Type.caption1.fontSize, color: t.accentLabel, fontWeight: '700' as const },
  showMePractised: {
    marginLeft: 36,
    marginTop: -2,
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    fontWeight: '600' as const,
  },
});
