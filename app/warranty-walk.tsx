// Warranty walk — close the loop on the home-screen banner.
//
// Pre-fix the banner pointed at /project-detail and the GC had no
// dedicated affordance to actually run the walk. This screen is the
// affordance: a curated checklist of the items a builder walks a month
// before his workmanship warranty expires, plus "log this walk as
// complete" → stamps project.warrantyWalkCompletedAt → suppresses the
// home-screen banner. Optionally emails the homeowner a summary of what
// was checked + what needs follow-up.
//
// #142: the copy follows HIS warranty length (utils/paymentTerms
// resolveWarrantyMonths) — "before your 24-month warranty closes", a
// "23-month walk" — instead of a hard-wired 12-month / "year-one" story.
// When he has not set one, the screen says it is assuming 12 months and
// where to set it, and the homeowner email names no month count at all.
//
// #143: the walk in progress is saved on this phone per job (see the draft
// codec in utils/warrantyWalks.ts) and restored on open, and leaving with
// unsaved ticks asks first.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ShieldCheck, CheckCircle2, Circle, AlertTriangle, Send, Mail,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { sendEmail } from '@/utils/emailService';
import { wrapEmailHtml, escapeHtml } from '@/utils/emailLayout';
import { generateUUID } from '@/utils/generateId';
import type { PunchItem } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { resolveWarrantyMonths } from '@/utils/paymentTerms';
import { formatCalendarDay } from '@/utils/calendarDate';
import {
  emptyWalkItems, parseWalkDraft, resolveWalkMonths, walkDraftIsEmpty, walkDraftKey,
  warrantyWalkLabel, warrantyWalkScheduleFor, type WalkItemState,
} from '@/utils/warrantyWalks';

// Standard pre-expiry walk items. Curated from NAHB's homeowner-walk
// checklist plus what residential GCs actually call back about. Phase
// = the trade group, used to color the row chip and group future
// reporting.
interface WalkItem {
  id: string;
  phase: 'Structural' | 'Exterior' | 'Plumbing' | 'Electrical' | 'HVAC' | 'Finishes' | 'Doors/Windows' | 'Site';
  title: string;
  /** What to look for / how to evaluate. */
  hint: string;
}

const DEFAULT_WALK_ITEMS: WalkItem[] = [
  { id: 'foundation-cracks',   phase: 'Structural',     title: 'Foundation: hairline cracks under 1/8"', hint: 'Normal settlement; flag anything wider or stair-stepping.' },
  { id: 'drywall-nailpops',    phase: 'Structural',     title: 'Drywall: nail pops, seam cracks, corner-bead', hint: 'Early settlement. One-time touch-up is typical.' },
  { id: 'roofing-flashing',    phase: 'Exterior',       title: 'Roof: flashing, ridge caps, attic for leaks', hint: 'Look for water staining at top plates / valley penetrations.' },
  { id: 'siding-caulk',        phase: 'Exterior',       title: 'Siding & exterior caulk: shrinkage / gaps', hint: 'Re-caulk where joints have separated; especially around windows.' },
  { id: 'gutters',             phase: 'Exterior',       title: 'Gutters: pitch + downspout discharge', hint: 'Confirm 4–6 ft splash-block extension; no standing water.' },
  { id: 'window-operation',    phase: 'Doors/Windows',  title: 'Windows: operation, seals, condensation', hint: 'Each opens, locks, and shows no failed insulating-glass fog.' },
  { id: 'door-alignment',      phase: 'Doors/Windows',  title: 'Doors: even reveal, latches, weatherstrip', hint: 'Settling rotates jambs — check the latch throws fully.' },
  { id: 'plumbing-leaks',      phase: 'Plumbing',       title: 'Plumbing: under sinks, water heater, hose bibs', hint: 'Open every sink trap area + check water heater pan.' },
  { id: 'plumbing-shutoffs',   phase: 'Plumbing',       title: 'Plumbing: angle stops, supply lines', hint: 'Each shutoff actuates; no calcified buildup or weeping.' },
  { id: 'electrical-gfci',     phase: 'Electrical',     title: 'Electrical: every GFCI test/reset', hint: 'Kitchen, baths, garage, exterior. Replace any that fail.' },
  { id: 'electrical-detectors',phase: 'Electrical',     title: 'Smoke/CO detectors: chirp test + battery age', hint: 'A battery swap at the walk is a homeowner expectation.' },
  { id: 'hvac-filters',        phase: 'HVAC',           title: 'HVAC filters + condensate drain + airflow', hint: 'New filter; flush condensate; balance complaint rooms.' },
  { id: 'finishes-touchup',    phase: 'Finishes',       title: 'Paint touch-up + grout/caulk in wet areas', hint: 'Tub-to-tile, kitchen counter-to-backsplash, expansion joints.' },
  { id: 'flooring',            phase: 'Finishes',       title: 'Flooring: squeaks, transitions, gaps', hint: 'Seasonal humidity cycle; minor gaps are normal.' },
  { id: 'site-grading',        phase: 'Site',           title: 'Site grading: positive drainage from foundation', hint: 'No ponding within 10 ft. Mulch beds reset away from siding.' },
];

type ItemState = WalkItemState;

const WALK_ITEM_IDS = DEFAULT_WALK_ITEMS.map(i => i.id);
/** Debounce for the draft save — a keystroke in a note is not a disk write. */
const DRAFT_SAVE_DEBOUNCE_MS = 300;

export default function WarrantyWalkScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const navigation = useNavigation();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, updateProject, addPunchItem, settings } = useProjects();
  const { isFree } = useTierAccess();
  const project = useMemo(() => projectId ? getProject(projectId) : null, [projectId, getProject]);

  // #142: HIS warranty length, 12 only as a stated assumption.
  const { months: warrantyMonths, assumed: monthsAssumed } = resolveWalkMonths(resolveWarrantyMonths(settings));
  const walkLabel = warrantyWalkLabel(warrantyMonths); // '11-month' | '23-month' | 'pre-expiry'
  const schedule = useMemo(
    () => (project ? warrantyWalkScheduleFor(project, warrantyMonths) : null),
    [project, warrantyMonths],
  );

  const [items, setItems] = useState<Record<string, ItemState>>(() => emptyWalkItems(WALK_ITEM_IDS));
  const [overallNotes, setOverallNotes] = useState('');
  const [completing, setCompleting] = useState(false);
  const [emailing, setEmailing] = useState(false);

  // ── #143: the draft ────────────────────────────────────────────────────
  // `hydrated` gates the saver: until the stored draft has been read, the
  // blank initial state must not be written over it. `finishedRef` stops a
  // debounced save from resurrecting the draft after the walk is logged or
  // discarded. Every read and write is best-effort (try/catch) — a failed
  // save costs the draft, never the walk.
  const draftKey = projectId ? walkDraftKey(projectId) : null;
  const [hydrated, setHydrated] = useState(false);
  const [resumedFrom, setResumedFrom] = useState<string | null>(null);
  const finishedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedAt = project?.warrantyWalkCompletedAt ?? null;

  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    if (!draftKey) { setHydrated(true); return; }
    void (async () => {
      let raw: string | null = null;
      try { raw = await AsyncStorage.getItem(draftKey); } catch { raw = null; }
      if (cancelled) return;
      const draft = parseWalkDraft(raw, WALK_ITEM_IDS, completedAt);
      if (draft) {
        setItems(draft.items);
        setOverallNotes(draft.overallNotes);
        setResumedFrom(draft.updatedAt);
      }
      setHydrated(true);
    })();
    return () => { cancelled = true; };
    // completedAt is read once per job on open: a walk logged from THIS screen
    // deletes the draft itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const writeDraft = useCallback(async (nextItems: Record<string, ItemState>, nextNotes: string) => {
    if (!draftKey || finishedRef.current) return;
    try {
      if (walkDraftIsEmpty(nextItems, nextNotes)) {
        await AsyncStorage.removeItem(draftKey);
      } else {
        await AsyncStorage.setItem(draftKey, JSON.stringify({
          items: nextItems, overallNotes: nextNotes, updatedAt: new Date().toISOString(),
        }));
      }
    } catch { /* best-effort: the walk on screen is untouched */ }
  }, [draftKey]);

  // Latest values for the leave guard and the flush — the listener is
  // registered once, so it reads refs, not a stale closure.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const notesRef = useRef(overallNotes);
  notesRef.current = overallNotes;

  useEffect(() => {
    if (!hydrated) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void writeDraft(items, overallNotes);
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [hydrated, items, overallNotes, writeDraft]);

  const clearDraft = useCallback(async () => {
    finishedRef.current = true;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (!draftKey) return;
    try { await AsyncStorage.removeItem(draftKey); } catch { /* best-effort */ }
  }, [draftKey]);

  // Leaving with ticks, flags or notes that are not logged asks first. The
  // draft is already on this phone, so "Leave" keeps it (flushing the pending
  // save now) and only "Discard" throws it away. The header chevron calls
  // router.back(), which fires this same listener; a successful log opens the
  // gate (allowLeave) before its own router.back().
  const allowLeave = useRef(false);
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (allowLeave.current || finishedRef.current) return;
    if (walkDraftIsEmpty(itemsRef.current, notesRef.current)) return;
    e.preventDefault();
    showAlert(
      'Leave this walk?',
      "It isn't logged yet. Your ticks, flags and notes are saved on this phone — open the walk again to pick up where you left off.",
      [
        { text: 'Keep walking', style: 'cancel' },
        {
          text: 'Discard walk',
          style: 'destructive',
          onPress: () => { void clearDraft().finally(() => { allowLeave.current = true; navigation.dispatch(e.data.action); }); },
        },
        {
          text: 'Leave — keep it',
          onPress: () => {
            if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
            void writeDraft(itemsRef.current, notesRef.current).finally(() => {
              allowLeave.current = true;
              navigation.dispatch(e.data.action);
            });
          },
        },
      ],
    );
  }), [navigation, clearDraft, writeDraft]);

  const totals = useMemo(() => {
    const checkedCount = Object.values(items).filter(s => s.checked).length;
    const flaggedCount = Object.values(items).filter(s => s.needsAttention).length;
    return { checkedCount, flaggedCount };
  }, [items]);

  const toggleChecked = useCallback((id: string) => {
    setItems(prev => ({ ...prev, [id]: { ...prev[id], checked: !prev[id].checked } }));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);
  const toggleAttention = useCallback((id: string) => {
    setItems(prev => ({ ...prev, [id]: { ...prev[id], needsAttention: !prev[id].needsAttention } }));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);
  const setItemNotes = useCallback((id: string, notes: string) => {
    setItems(prev => ({ ...prev, [id]: { ...prev[id], notes } }));
  }, []);

  const handleComplete = useCallback(async () => {
    if (!project) return;
    setCompleting(true);
    try {
      updateProject(project.id, {
        warrantyWalkCompletedAt: new Date().toISOString(),
      });

      // Convert every flagged item into a durable, high-priority punch item so
      // the flag survives the walk — pre-fix the per-item state lived only in
      // local useState and evaporated once the screen closed, leaving no
      // tracked follow-up despite the hero copy's "flag it now" promise.
      const now = new Date().toISOString();
      let createdPunchCount = 0;
      for (const it of DEFAULT_WALK_ITEMS) {
        const state = items[it.id];
        if (!state?.needsAttention) continue;
        const note = state.notes.trim();
        const punch: PunchItem = {
          id: generateUUID(),
          projectId: project.id,
          description: note ? `${it.title} — ${note}` : it.title,
          location: it.phase,
          assignedSub: '',
          dueDate: '',
          priority: 'high',
          status: 'open',
          createdAt: now,
          updatedAt: now,
        };
        addPunchItem(punch);
        createdPunchCount += 1;
      }

      // The walk is on the project now; the draft is done. Deleted before the
      // alert so a kill between here and OK cannot restore a logged walk.
      void clearDraft();
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(
        'Walk logged',
        `${totals.checkedCount} item${totals.checkedCount === 1 ? '' : 's'} checked${
          createdPunchCount > 0
            ? `, ${createdPunchCount} flagged item${createdPunchCount === 1 ? '' : 's'} added to the punch list for follow-up`
            : ''
        }. The home-screen banner will clear once you reload.`,
        [{ text: 'OK', onPress: () => { allowLeave.current = true; router.back(); } }],
      );
    } catch (err) {
      showAlert('Save failed', (err as Error).message ?? 'Try again.');
    } finally {
      setCompleting(false);
    }
  }, [project, items, totals, updateProject, addPunchItem, router, clearDraft]);

  const handleEmailHomeowner = useCallback(async () => {
    if (!project) return;
    const portalInvites = project.clientPortal?.invites ?? [];
    const recipients = portalInvites
      .filter(i => (i.email ?? '').includes('@'))
      .map(i => ({ email: i.email!.trim(), name: i.name }));
    if (recipients.length === 0) {
      showAlert(
        'No homeowner email on file',
        'Add the homeowner as a portal invite (Project → Portal → Invites) so we can email them the walk summary.',
      );
      return;
    }
    setEmailing(true);
    try {
      const companyName = settings?.branding?.companyName || 'MAGE ID';
      // #142: the homeowner reads a month count only when it is HIS — with no
      // warranty set, "11-month" would be our assumption printed as his term.
      const emailWalk = monthsAssumed ? 'warranty walk' : `${walkLabel} warranty walk`;
      const emailWalkTitle = monthsAssumed ? 'warranty walk' : `${walkLabel} walk`;
      const checkedRows = DEFAULT_WALK_ITEMS
        .filter(it => items[it.id]?.checked)
        .map(it => `<li style="margin-bottom:6px;color:#4A5159;">${escapeHtml(it.title)}${items[it.id]?.notes ? ` <span style="color:#9AA3AD;">— ${escapeHtml(items[it.id].notes)}</span>` : ''}</li>`)
        .join('');
      const flaggedRows = DEFAULT_WALK_ITEMS
        .filter(it => items[it.id]?.needsAttention)
        .map(it => `<li style="margin-bottom:6px;color:#7A4500;">${escapeHtml(it.title)}${items[it.id]?.notes ? ` <span style="color:#9AA3AD;">— ${escapeHtml(items[it.id].notes)}</span>` : ''}</li>`)
        .join('');
      const html = wrapEmailHtml({
        preheader: `${companyName} completed the ${emailWalk} for ${project.name}.`,
        eyebrow: 'Warranty walk',
        title: `${project.name} — ${emailWalkTitle}`,
        subtitle: `${companyName} walked the home with you in mind. Here's what we checked and what we'll follow up on.`,
        bodyHtml: [
          checkedRows
            ? `<p style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#0B0D10;">Items checked (${totals.checkedCount})</p>
               <ul style="margin:0 0 18px 0;padding:0 0 0 18px;font-size:13px;line-height:20px;">${checkedRows}</ul>`
            : '',
          flaggedRows
            ? `<p style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#7A4500;">Flagged for follow-up (${totals.flaggedCount})</p>
               <ul style="margin:0 0 18px 0;padding:0 0 0 18px;font-size:13px;line-height:20px;">${flaggedRows}</ul>
               <p style="margin:0 0 14px 0;font-size:13px;color:#4A5159;">We'll reach out to schedule the follow-up work covered under your warranty.</p>`
            : '',
          overallNotes ? `<p style="margin:0 0 14px 0;font-size:13px;line-height:20px;color:#4A5159;"><strong style="color:#0B0D10;">Notes:</strong> ${escapeHtml(overallNotes)}</p>` : '',
        ].join(''),
        companyName,
        project: { name: project.name, location: project.location },
        sender: {
          name: settings?.branding?.contactName,
          email: settings?.branding?.email,
          phone: settings?.branding?.phone,
        },
        growthBadge: isFree,
      });
      const subject = `${project.name} — ${emailWalk} summary`;
      const results = await Promise.all(recipients.map(r => sendEmail({
        to: r.email,
        subject,
        html,
        replyTo: settings?.branding?.email,
        fromCompanyName: companyName,
      })));
      const sentCount = results.filter(r => r.success).length;
      if (sentCount > 0) {
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showAlert('Summary sent', `Sent to ${sentCount} recipient${sentCount === 1 ? '' : 's'}.`);
      } else {
        showAlert('Send failed', 'No emails went out — check your network and try again.');
      }
    } finally {
      setEmailing(false);
    }
  }, [project, settings, items, totals, overallNotes, isFree, monthsAssumed, walkLabel]);

  // Group items by phase for cleaner scrolling. Computed BEFORE the
  // `!project` early return so the hook call order stays stable across
  // renders (rules-of-hooks). The grouping doesn't depend on project, so
  // moving it up is free.
  const grouped = useMemo(() => {
    const map = new Map<WalkItem['phase'], WalkItem[]>();
    for (const it of DEFAULT_WALK_ITEMS) {
      const arr = map.get(it.phase) ?? [];
      arr.push(it);
      map.set(it.phase, arr);
    }
    return Array.from(map.entries());
  }, []);

  if (!project) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Warranty Walk' }} />
        <Text style={styles.loadingText}>Project not found.</Text>
      </View>
    );
  }

  const alreadyDone = !!project.warrantyWalkCompletedAt;

  return (
    <>
      <Stack.Screen
        options={{
          title: monthsAssumed ? 'Warranty walk' : `${walkLabel.charAt(0).toUpperCase()}${walkLabel.slice(1)} walk`,
          headerLeft: () => (
            // router.back() fires the beforeRemove guard above, like a swipe.
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back">
              <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView {...fabScroll} style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <ShieldCheck size={20} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.heroTitle}>{project.name}</Text>
          <Text style={styles.heroBody}>
            {monthsAssumed
              ? 'Walk the home with the homeowner before your warranty closes. Anything you find now is still yours to fix under it; flagging it before the end beats a "we noticed this last week" call the month after.'
              : `Walk the home with the homeowner before your ${warrantyMonths}-month warranty closes. Anything you find now is still yours to fix under it; flagging it before the end beats a "we noticed this last week" call the month after.`}
          </Text>
          {monthsAssumed ? (
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/settings' as never)}
              accessibilityRole="button"
              accessibilityLabel="Set your warranty length in Settings"
              testID="warranty-walk-set-warranty"
            >
              <Text style={styles.heroNote}>
                No warranty length is set, so these dates assume 12 months. Set yours in Settings → How you get paid ›
              </Text>
            </TouchableOpacity>
          ) : null}
          {schedule ? (
            <Text style={styles.heroNote} testID="warranty-walk-dates">
              Walk by {formatCalendarDay(schedule.walkDueDate)} · warranty ends {formatCalendarDay(schedule.warrantyExpiresAt)}
              {schedule.warrantyStartSource === 'closed'
                ? ` — counted from the day you closed the job (${formatCalendarDay(schedule.warrantyStartDate)}). A G704 in the Closeout Binder sets the real substantial-completion date.`
                : ` — counted from substantial completion (${formatCalendarDay(schedule.warrantyStartDate)}).`}
            </Text>
          ) : null}
          {resumedFrom ? (
            <Text style={styles.heroNote} testID="warranty-walk-resumed">
              Resumed your walk from {new Date(resumedFrom).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
            </Text>
          ) : null}
          {alreadyDone && (
            <View style={styles.doneBadge}>
              <CheckCircle2 size={14} color={themeColors.success} strokeWidth={1.75} />
              <Text style={styles.doneBadgeText}>
                Walk completed {new Date(project.warrantyWalkCompletedAt!).toLocaleDateString()}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{totals.checkedCount}</Text>
            <Text style={styles.summaryLabel}>Checked</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryValue, { color: Colors.warningLabel }]}>{totals.flaggedCount}</Text>
            <Text style={styles.summaryLabel}>Flagged</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{DEFAULT_WALK_ITEMS.length - totals.checkedCount - totals.flaggedCount}</Text>
            <Text style={styles.summaryLabel}>Untouched</Text>
          </View>
        </View>

        {grouped.map(([phase, list]) => (
          <View key={phase} style={styles.phaseGroup}>
            <Text style={styles.phaseLabel}>{phase}</Text>
            {list.map(it => {
              const state = items[it.id];
              return (
                <View key={it.id} style={[styles.itemCard, state.needsAttention && { borderColor: Colors.warning, backgroundColor: Colors.warning + '08' }]}>
                  <View style={styles.itemHeader}>
                    <TouchableOpacity onPress={() => toggleChecked(it.id)} style={styles.checkbox} activeOpacity={0.85}>
                      {state.checked
                        ? <CheckCircle2 size={20} color={themeColors.success} strokeWidth={1.75} />
                        : <Circle size={20} color={themeColors.textMuted} strokeWidth={1.75} />}
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle}>{it.title}</Text>
                      <Text style={styles.itemHint}>{it.hint}</Text>
                    </View>
                    <TouchableOpacity onPress={() => toggleAttention(it.id)} style={styles.flagBtn} activeOpacity={0.85}>
                      <AlertTriangle size={16} color={state.needsAttention ? Colors.warning : themeColors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                  {(state.checked || state.needsAttention) && (
                    <TextInput
                      style={styles.itemNotes}
                      value={state.notes}
                      onChangeText={t => setItemNotes(it.id, t)}
                      placeholder={state.needsAttention ? 'What needs follow-up?' : 'Notes (optional)'}
                      placeholderTextColor={themeColors.textMuted}
                      multiline
                    />
                  )}
                </View>
              );
            })}
          </View>
        ))}

        <Text style={styles.sectionLabel}>Overall notes</Text>
        <TextInput
          style={styles.overallNotes}
          value={overallNotes}
          onChangeText={setOverallNotes}
          placeholder="Anything the homeowner asked about, big-picture observations, etc."
          placeholderTextColor={themeColors.textMuted}
          multiline
        />

        <TouchableOpacity
          onPress={handleEmailHomeowner}
          disabled={emailing || (totals.checkedCount === 0 && totals.flaggedCount === 0)}
          activeOpacity={0.85}
          style={[styles.secondaryBtn, (emailing || (totals.checkedCount === 0 && totals.flaggedCount === 0)) && { opacity: 0.6 }]}
        >
          {emailing ? <ActivityIndicator color={themeColors.accent} /> : <Mail size={16} color={themeColors.accent} strokeWidth={1.75} />}
          <Text style={styles.secondaryBtnText}>Email summary to homeowner</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleComplete}
          disabled={completing}
          activeOpacity={0.85}
          style={[styles.primaryBtn, completing && { opacity: 0.6 }]}
        >
          {completing ? <ActivityIndicator color="#FFF" /> : <Send size={16} color="#FFF" strokeWidth={1.75} />}
          <Text style={styles.primaryBtnText}>
            {alreadyDone ? 'Update walk-completed date' : 'Mark walk complete'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: Type.body.fontSize, color: t.textMuted },

  hero: {
    margin: 16, padding: 18, borderRadius: Tokens.radius.panel,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '20',
  },
  heroIconWrap: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, marginBottom: 8 },
  heroBody: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },
  heroNote: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17, marginTop: 8 },
  doneBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12, padding: 8, borderRadius: Tokens.radius.md,
    backgroundColor: t.success + '14', alignSelf: 'flex-start',
  },
  doneBadgeText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.success },

  summaryRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  summaryCell: {
    flex: 1, padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
    alignItems: 'center',
  },
  summaryValue: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text },
  summaryLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },

  phaseGroup: { marginBottom: 12 },
  phaseLabel: {
    paddingHorizontal: 16, marginTop: 6, marginBottom: 6,
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  itemCard: {
    marginHorizontal: 16, marginBottom: 6, padding: 12,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  itemHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  checkbox: { paddingTop: 2 },
  itemTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  itemHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 16 },
  flagBtn: { padding: 6 },
  itemNotes: {
    marginTop: 10, padding: 10, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt, fontSize: Type.caption1.fontSize, color: t.text,
    minHeight: 50, textAlignVertical: 'top' as const,
  },

  sectionLabel: {
    paddingHorizontal: 16, marginTop: 6, marginBottom: 6,
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  overallNotes: {
    marginHorizontal: 16, padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
    minHeight: 80, fontSize: Type.bodyCompact.fontSize, color: t.text,
    textAlignVertical: 'top' as const,
  },

  primaryBtn: {
    marginHorizontal: 16, marginTop: 12,
    paddingVertical: 14, borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  primaryBtnText: { color: '#FFF', fontSize: Type.body.fontSize, fontWeight: '700' },
  secondaryBtn: {
    marginHorizontal: 16, marginTop: 12,
    paddingVertical: 12, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '12',
    borderWidth: 1, borderColor: t.accent + '30',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  secondaryBtnText: { color: t.accent, fontSize: Type.footnote.fontSize, fontWeight: '700' },
});
