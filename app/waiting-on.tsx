// app/waiting-on.tsx — "Waiting on others" (the System of Action).
//
// Every incumbent tool STORES your RFIs and submittals; none of them chase the
// architect for a response — a person still does that. This screen is MAGE
// doing the chasing: one list of everything parked with someone else, ranked by
// how overdue it is, each with a follow-up already written and ready to send.
//
// Anti-slop: Colors/Type/Tokens + lucide only.
//
// ── The chase has to survive the screen ──────────────────────────────────────
// This list used to hold what he had sent in a component-state Set, so every
// "Follow-up sent" chip evaporated the moment he navigated away. Tuesday's list
// looked exactly like Monday's: the same red row, equally untouched. That costs
// him twice — he chases the architect a second time and looks disorganised to
// the design team he depends on, or he is not sure whether he sent it and a
// second week goes by. And when the job goes sideways, "I chased RFI #12 four
// times over three weeks" is the difference between a delay claim he wins and
// one he eats, and there was no record of a single one of those chases.
//
// The chases are now written to the HELD face of the follow-up engine
// (FollowUpHold / FollowUpChase in types/index.ts) — the one thing that engine
// persists, because it is the one thing it cannot recompute. The chase LIST
// itself is still derived on every mount and is never stored; persisting a
// derived list is how it goes stale and starts lying.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Share, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ChevronRight, Send, CheckCircle2, History, FileQuestion, FileCheck, FileSignature, Truck, HardHat } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useCoreData, useDocsData, useFinancialsData, useFieldData } from '@/contexts/ProjectContext';
import { buildChaseList, chaseSummary, type ChaseItem, type ChaseKind } from '@/utils/systemOfAction';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { copyToClipboard } from '@/utils/clipboard';
import { calendarDayOf, daysUntilCalendarDay, formatCalendarDay } from '@/utils/calendarDate';
import type { FollowUpChase, FollowUpHold } from '@/types';

/**
 * Where the chase log lives.
 *
 * The `mageid_` prefix is load-bearing, not cosmetic. wipeLocalUserCache
 * (contexts/AuthContext.tsx) sweeps local storage by PREFIX over getAllKeys(),
 * and the complete list of prefixes it recognises is APP_STORAGE_PREFIXES in
 * utils/localCacheKeys.ts. A key under a brand-new prefix is invisible to that
 * sweep, survives sign-out, and — on web, where AsyncStorage *is* the origin's
 * localStorage — hands the next contractor to sign in on a site-office iPad
 * this one's chase log, complete with the drafted messages and the names of
 * the people in them. bun run test:storage-hygiene fails the build on that.
 *
 * Local-only on purpose, for now: FollowUpHold has no Supabase table yet, so
 * there is nothing for utils/offlineQueue to write to. When one lands, the
 * write goes through supabaseWrite like every other — see the handoff note on
 * recordChase.
 */
const FOLLOW_UP_HOLDS_KEY = 'mageid_follow_up_holds';

/**
 * The id a chase is filed under. NOT ChaseItem.id.
 *
 * ChaseItem ids are inconsistent by kind: rfi, submittal and co_approval carry
 * the bare record id, while delivery and quiet_trade already namespace
 * themselves ('delivery:<id>', 'quiet:<projectId>:<trade>' — systemOfAction.ts).
 * A bare record id can therefore collide ACROSS kinds, and the in-memory `sent`
 * Set this replaces really did collide: it was keyed on item.id alone, so an
 * RFI and a submittal that happened to share a row id marked each other sent.
 *
 * Prefixing with the kind also matches the follow-up engine's own
 * `${ruleId}:${primaryKind}:${primaryId}` id scheme (utils/followUp/rules.ts),
 * so when a rule is written for one of these kinds the derived face and the
 * held face join on a key that is already namespaced, instead of forking into
 * a second, incompatible store that the delay-evidence export would then have
 * to be built twice for.
 *
 * The doubled prefix on delivery ('delivery:delivery:<id>') is ugly and
 * deliberate — determinism across devices and re-derives is the contract here,
 * not prettiness, and rewriting the ids would orphan every chase already on
 * disk.
 */
function chaseHoldId(item: ChaseItem): string {
  return `${item.kind}:${item.id}`;
}

/**
 * "Chased 3× · last Tue", or null when he has never chased this one.
 *
 * Deliberately says CHASED, never "sent" or "delivered". All the app witnessed
 * is the tap — the message went to the OS share sheet or to his clipboard and
 * the app lost sight of it there. The hero carries that caveat in words; this
 * label just avoids making the stronger claim.
 *
 * Dates go through utils/calendarDate because the stored value is a full ISO
 * instant: `new Date('2026-09-14')` is UTC midnight and prints the 13th
 * anywhere west of Greenwich, which would age every evening chase by a day.
 */
function chaseLabel(hold: FollowUpHold | undefined, now: Date): string | null {
  const count = hold?.chases?.length ?? 0;
  if (count === 0) return null;
  const day = calendarDayOf(hold?.lastFollowUpAt);
  const delta = day ? daysUntilCalendarDay(day, now) : null;
  const when =
    delta === 0 ? 'today'
      : delta === -1 ? 'yesterday'
        // Inside the last week a weekday is how he actually remembers it
        // ("I chased him Tuesday"); older than that a weekday is ambiguous.
        : delta !== null && delta > -7 ? `last ${formatCalendarDay(day, { weekday: 'short' })}`
          : day ? formatCalendarDay(day, { month: 'short', day: 'numeric' })
            : null;
  return when ? `Chased ${count}× · ${when}` : `Chased ${count}×`;
}

const KIND_ICON: Record<ChaseKind, typeof FileQuestion> = {
  rfi: FileQuestion,
  submittal: FileCheck,
  co_approval: FileSignature,
  // A late load stalls a crew, not a decision — it belongs in the same list.
  delivery: Truck,
  // A sub who worked for days then vanished is the purest "waiting on" there is.
  quiet_trade: HardHat,
};

export default function WaitingOnScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projects } = useCoreData();
  const { rfis, submittals } = useDocsData();
  const { dailyReports } = useFieldData();
  const { changeOrders, deliveries } = useFinancialsData();
  const { isDesktop } = useResponsiveLayout();
  // The held face: hold id → FollowUpHold. Loaded once from disk, written back
  // on every change. `holdsLoaded` exists so the persist effect below cannot
  // write the empty initial map over a log it has not finished reading.
  const [holds, setHolds] = useState<Record<string, FollowUpHold>>({});
  const [holdsLoaded, setHoldsLoaded] = useState(false);
  const persistedRef = useRef<string | null>(null);

  // crewPresence works per project — absence is only meaningful against THAT
  // job's reporting cadence, so a portfolio-wide fold would let a busy site's
  // daily reports mask a quiet one's silence.
  const dailyReportsByProject = useMemo(() => {
    const byProject: Record<string, typeof dailyReports> = {};
    for (const r of dailyReports ?? []) {
      (byProject[r.projectId] ??= []).push(r);
    }
    return byProject;
  }, [dailyReports]);

  const items = useMemo(
    () =>
      buildChaseList({
        rfis: rfis ?? [],
        submittals: submittals ?? [],
        changeOrders: changeOrders ?? [],
        projects: projects ?? [],
        // Without this the late-delivery branch in buildChaseList
        // (systemOfAction.ts) iterates `opts.deliveries ?? []` and is
        // permanently empty — a whole chase kind built and never fed. It is
        // also what gives /deliveries its first reachable route from here.
        deliveries: deliveries ?? [],
        dailyReportsByProject,
        nowMs: Date.now(),
      }),
    [rfis, submittals, changeOrders, projects, deliveries, dailyReportsByProject],
  );
  const summary = useMemo(() => chaseSummary(items), [items]);

  // ── Load the chase log ────────────────────────────────────────────────────
  // A corrupt or unreadable blob is swallowed on purpose. The chase list is
  // derived and stays completely correct without the log — he just loses the
  // "chased 3×" history — so failing loudly here would cost him the whole
  // screen to protect a decoration.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(FOLLOW_UP_HOLDS_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          persistedRef.current = raw;
          setHolds(parsed as Record<string, FollowUpHold>);
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setHoldsLoaded(true); });
    return () => { alive = false; };
  }, []);

  // ── Write it back ─────────────────────────────────────────────────────────
  // Persisting in an effect rather than inside recordChase keeps the state
  // updater pure (React 18 invokes updaters twice in dev, and a write from
  // inside one would fire twice with a half-applied map). persistedRef skips
  // the no-op write this would otherwise do on every mount.
  useEffect(() => {
    if (!holdsLoaded) return;
    const blob = JSON.stringify(holds);
    if (persistedRef.current === blob) return;
    persistedRef.current = blob;
    AsyncStorage.setItem(FOLLOW_UP_HOLDS_KEY, blob).catch(() => {});
  }, [holds, holdsLoaded]);

  /**
   * Record that a follow-up left the app.
   *
   * `at` is the moment of the TAP — see the honesty note on FollowUpChase. The
   * message is stored with it so the log is evidence ("here is what I sent him
   * on the 3rd") rather than a tally.
   *
   * HANDOFF, not done here: the same tap should also write a CommunicationEvent
   * via addCommEvent (contexts/ProjectContext.tsx), which is synced and
   * cascade-deleted, and app/delay-events.tsx should grow a `comm_event` loop
   * in availableEvidence — 'comm_event' is already a declared DelayEvidenceKind
   * that nothing populates, so "I chased this four times" becomes attachable
   * delay evidence with no new type and no migration. Both files belong to
   * other work in flight; this screen owns only the held record.
   */
  const recordChase = useCallback((item: ChaseItem, via: FollowUpChase['via']) => {
    const id = chaseHoldId(item);
    const at = new Date().toISOString();
    const chase: FollowUpChase = { at, via, message: item.nudge };
    setHolds((prev) => {
      const existing = prev[id];
      const chases = [...(existing?.chases ?? []), chase];
      const hold: FollowUpHold = {
        ...existing,
        id,
        projectId: item.projectId,
        // His ENGAGEMENT with the item, not the record's own status — the RFI
        // is still open, he has just now chased it (see FollowUpStatus).
        status: 'chased',
        chases,
        // Denormalised from the array it is written beside, in the same
        // statement, so the two can never disagree.
        lastFollowUpAt: at,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      };
      return { ...prev, [id]: hold };
    });
  }, []);

  /**
   * Rank for "where do the next ten minutes go", not just "what is reddest".
   *
   * Never-chased items come first: an untouched row is work nobody has done,
   * while a chased one is already in someone else's hands. Among the chased,
   * the one he has left alone LONGEST comes first — a row he nudged this
   * morning is not where the next ten minutes belong. Inside each band the
   * engine's own most-overdue-first order is the tiebreak.
   */
  const ranked = useMemo(() => {
    const lastChase = (i: ChaseItem) => holds[chaseHoldId(i)]?.lastFollowUpAt;
    return [...items].sort((a, b) => {
      const la = lastChase(a);
      const lb = lastChase(b);
      if (!la !== !lb) return la ? 1 : -1;
      if (la && lb && la !== lb) return la < lb ? -1 : 1;
      return b.daysOverdue - a.daysOverdue;
    });
  }, [items, holds]);

  // One clock for the whole render, so two rows cannot resolve "today" against
  // different midnights in the same list.
  const now = new Date();
  const chasedCount = useMemo(
    () => items.filter((i) => (holds[chaseHoldId(i)]?.chases?.length ?? 0) > 0).length,
    [items, holds],
  );

  const sendNudge = async (item: ChaseItem) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Sending the follow-up is the ONLY action on this screen — the entire
    // point of the System of Action — and on web it used to throw instantly.
    // react-native-web's Share rejects outright when navigator.share is absent,
    // which is desktop Firefox and Chromium on Linux, and the old copy told the
    // user to "copy it from the item" when the nudge renders numberOfLines={3}
    // and cannot be selected. Clipboard is the honest fallback: same outcome,
    // one paste away. (app/sub-portal-setup.tsx solved this same problem once
    // already, with a send modal.)
    const canWebShare = Platform.OS !== 'web'
      || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

    if (!canWebShare) {
      const ok = await copyToClipboard(item.nudge);
      if (ok) recordChase(item, 'clipboard');
      showAlert(
        ok ? 'Follow-up copied' : 'Could not copy',
        ok ? 'Paste it into your email or text to send it.'
           : 'Select the follow-up text and copy it manually.',
      );
      return;
    }

    try {
      await Share.share({ message: item.nudge });
      recordChase(item, 'share');
    } catch (e) {
      // A user dismissing the native/Web Share sheet rejects with AbortError.
      // That is a cancel, not a failure — reporting it as one taught people the
      // button was broken. It is also not a chase: nothing left the app.
      if (e instanceof Error && e.name === 'AbortError') return;
      const ok = await copyToClipboard(item.nudge);
      // The share failed but the text IS on his clipboard, which is exactly the
      // claim the !canWebShare branch above records. Not recording it here left
      // a real chase off the log purely because the share sheet misbehaved.
      if (ok) recordChase(item, 'clipboard');
      showAlert(
        ok ? 'Follow-up copied instead' : 'Could not open share',
        ok ? 'Sharing was unavailable, so the follow-up is on your clipboard.'
           : 'Copy the follow-up from the item instead.',
      );
    }
  };

  const severityColor = (s: ChaseItem['severity']) =>
    s === 'critical' ? t.danger : s === 'high' ? Colors.warning : t.textSecondary;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={t.text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <MageAIMark size={15} color={t.accent} />
          <Text style={styles.headerTitle} numberOfLines={1}>Waiting on others</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.content, isDesktop && styles.contentDesktop]}>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>Parked with someone else</Text>
            {summary.total > 0 ? (
              <>
                <Text style={styles.heroStat}>
                  {summary.total} {summary.total === 1 ? 'item' : 'items'} overdue
                </Text>
                <Text style={styles.heroSub}>
                  {summary.critical > 0
                    ? `${summary.critical} over a week late. `
                    : ''}
                  Each one has a follow-up written and ready — send it without typing.
                </Text>
                {chasedCount > 0 && (
                  // The grounding chip for the chase counts below. All the app
                  // witnessed is the tap: the message went to the share sheet
                  // or the clipboard and it lost sight of it there. Saying
                  // "sent" — which this screen used to — claims more than it
                  // knows, and a delay claim built on an overstated record is
                  // worse than no record.
                  <View style={styles.groundingRow}>
                    <History size={12} color={t.textMuted} strokeWidth={2} />
                    <Text style={styles.groundingText}>
                      {chasedCount} chased and still open. Counted when you tap Send —
                      MAGE records that you sent it, not that anyone read it.
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.heroStat}>Nobody's holding you up</Text>
                <Text style={styles.heroSub}>
                  No RFIs, submittals, or approvals are sitting overdue with anyone else.
                </Text>
              </>
            )}
          </View>

          {summary.total === 0 ? (
            <View style={styles.emptyCard}>
              <CheckCircle2 size={18} color={t.success} strokeWidth={2} />
              <Text style={styles.emptyText}>Nothing to chase. Go build.</Text>
            </View>
          ) : (
            <View style={isDesktop ? styles.cardGrid : undefined}>
            {ranked.map((item) => {
              const Icon = KIND_ICON[item.kind];
              const sc = severityColor(item.severity);
              const hold = holds[chaseHoldId(item)];
              const chased = chaseLabel(hold, now);
              return (
                <View key={`${item.kind}-${item.id}`} style={[styles.card, isDesktop && styles.cardDesktop]}>
                  <TouchableOpacity
                    style={styles.cardTop}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${item.title}`}
                    onPress={() =>
                      router.push({ pathname: item.route.pathname as never, params: item.route.params })
                    }
                  >
                    <View style={[styles.iconWrap, { backgroundColor: sc + '18' }]}>
                      <Icon size={14} color={sc} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.cardMeta} numberOfLines={1}>
                        {item.projectName} · with {item.waitingOn}
                      </Text>
                    </View>
                    <View style={styles.lateBox}>
                      <Text style={[styles.lateNum, { color: sc }]}>{item.daysOverdue}d</Text>
                      <Text style={styles.lateLabel}>late</Text>
                    </View>
                    <ChevronRight size={14} color={t.textMuted} strokeWidth={2} />
                  </TouchableOpacity>

                  <Text style={styles.nudge} numberOfLines={3}>{item.nudge}</Text>

                  {chased && (
                    // The chase history, on the row it belongs to. This is what
                    // stops the Tuesday double-nudge: the row says he already
                    // chased the architect on Monday, and how many times before
                    // that. It is not a "done" badge — the item is still
                    // overdue and still needs an answer, which is why the
                    // button below still reads as an action.
                    <View style={styles.chasedRow}>
                      <History size={12} color={t.textSecondary} strokeWidth={2} />
                      <Text style={styles.chasedText} numberOfLines={1}>{chased}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={styles.sendBtn}
                    onPress={() => void sendNudge(item)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={
                      chased
                        ? `Chase ${item.title} again. ${chased}`
                        : `Send follow-up about ${item.title}`
                    }
                    testID={`nudge-${item.id}`}
                  >
                    <Send size={13} color={t.accent} strokeWidth={2.25} />
                    <Text style={styles.sendText}>
                      {chased ? 'Chase again' : 'Send follow-up'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Tokens.spacing.sm,
      paddingVertical: Tokens.spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
    headerTitle: { ...Type.serifHeadline, color: t.text },
    scroll: { paddingBottom: 40 },
    content: {
      width: '100%',
      alignSelf: 'center',
      paddingHorizontal: Tokens.spacing.md,
      paddingTop: Tokens.spacing.lg,
    },
    // Desktop: a chase LIST, not prose. Use the viewport and grid the cards.
    contentDesktop: { maxWidth: 1400, paddingHorizontal: Tokens.spacing.lg },
    cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Tokens.spacing.sm },
    cardDesktop: { flexGrow: 1, flexBasis: 380, maxWidth: 520, marginBottom: 0 },
    hero: { marginBottom: Tokens.spacing.lg },
    eyebrow: {
      ...Type.caption1,
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 2,
    },
    heroStat: { ...Type.title2, color: t.text },
    heroSub: { ...Type.subhead, color: t.textSecondary, marginTop: 4 },
    groundingRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginTop: Tokens.spacing.sm,
    },
    groundingText: { ...Type.caption2, color: t.textMuted, flex: 1, lineHeight: 15 },
    card: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      marginBottom: Tokens.spacing.sm,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm },
    iconWrap: {
      width: 28,
      height: 28,
      borderRadius: Tokens.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    cardTitle: { ...Type.footnoteEmphasized, color: t.text },
    cardMeta: { ...Type.caption1, color: t.textSecondary, marginTop: 1 },
    lateBox: { alignItems: 'flex-end' },
    lateNum: { ...Type.subheadEmphasized, fontVariant: ['tabular-nums'] },
    lateLabel: { ...Type.caption2, color: t.textMuted },
    nudge: {
      ...Type.caption1,
      color: t.textSecondary,
      lineHeight: 17,
      marginTop: Tokens.spacing.sm,
      paddingTop: Tokens.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.line,
    },
    sendBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: Tokens.spacing.sm,
      paddingVertical: 9,
      borderRadius: Tokens.radius.md,
      borderWidth: 1,
      borderColor: t.accentSoft,
      backgroundColor: t.surfaceAlt,
    },
    sendText: { ...Type.caption1, color: t.accent, fontWeight: '700' },
    chasedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: Tokens.spacing.sm,
    },
    chasedText: { ...Type.caption2, color: t.textSecondary, flex: 1 },
    emptyCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.sm,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
    },
    emptyText: { ...Type.footnote, color: t.textSecondary, flex: 1 },
  });
