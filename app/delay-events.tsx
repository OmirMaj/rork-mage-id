// app/delay-events.tsx — the delay register.
//
// Spec: docs/superpowers/specs/2026-08-03-claim-defense-design.md §2.2–§3.5.
//
// The app already captures six kinds of delay evidence and NONE of them
// reference each other: there is no object that says "this photo, this weather
// day, this RFI, and this CO are the same delay." This screen is that object,
// plus the clock that keeps a real claim from being waived on a missed notice
// window.
//
// Entry points that write here:
//   * app/daily-report.tsx — the Issues & Delays field
//   * app/schedule-pro.tsx — the weather reschedule confirmation
// Both push here with prefill params rather than duplicating the form.
//
// Anti-slop: ThemeColors / Type / Tokens + lucide only. showAlert, never
// Alert.alert.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, Plus, X as XIcon, CalendarClock, AlertTriangle,
  ShieldAlert, Paperclip, Check, FileText, Camera, CloudRain, HelpCircle,
  Receipt, Repeat, Send,
} from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { generateUUID } from '@/utils/generateId';
import {
  buildNoticeStatus, noticeSummary, nextDelayEventNumber, formatDelayEventNumber,
  suggestClassification, noticeMethodWarning, noticeViolations, noticeMethodLabel,
  effectiveNoticePeriod, noticeDeadline,
  CAUSE_LABEL, CLASSIFICATION_LABEL, NOTICE_PERIOD_PRESETS, ASSUMED_NOTICE_PERIOD_DAYS,
  ASSUMED_LABEL, NOTICE_PERIOD_QUESTION, RECORDING_IS_NOT_SERVING,
  type NoticeStatus,
} from '@/utils/noticeClock';
import type {
  DelayCause, DelayClassification, DelayEvent, DelayEvidenceKind, DelayEvidenceRef,
  DelayNotice, DelayNoticeMethod, Project,
} from '@/types';

const CAUSES: DelayCause[] = [
  'weather', 'owner_directed_change', 'late_rfi_response', 'differing_site_condition',
  'owner_supplied_item', 'permit_or_inspection', 'design_revision', 'contractor_caused', 'other',
];

const CLASSIFICATIONS: DelayClassification[] = [
  'unclassified', 'excusable_compensable', 'excusable_noncompensable', 'nonexcusable',
];

const METHODS: DelayNoticeMethod[] = [
  'certified_mail', 'courier', 'hand_delivered', 'email', 'portal', 'other',
];

const NOTICE_KINDS: DelayNotice['kind'][] = ['initial', 'supplemental', 'reservation_of_rights'];

const NOTICE_KIND_LABEL: Record<DelayNotice['kind'], string> = {
  initial: 'Notice of claim',
  supplemental: 'Acceleration notice',
  reservation_of_rights: 'Reservation of rights',
};

const EVIDENCE_ICON: Record<DelayEvidenceKind, typeof FileText> = {
  photo: Camera,
  daily_report: FileText,
  rfi: HelpCircle,
  weather_log: CloudRain,
  field_ticket: Receipt,
  comm_event: Send,
  schedule_audit: CalendarClock,
  change_order: Repeat,
};

const EVIDENCE_KIND_LABEL: Record<DelayEvidenceKind, string> = {
  photo: 'Photo',
  daily_report: 'Daily report',
  rfi: 'RFI',
  weather_log: 'Weather delay log',
  field_ticket: 'Field ticket',
  comm_event: 'Communication',
  schedule_audit: 'Schedule change',
  change_order: 'Change order',
};

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toInt(s: string): number {
  const n = Number.parseInt(s.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export default function DelayEventsScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDesktop } = useResponsiveLayout();

  const params = useLocalSearchParams<{
    projectId?: string;
    delayEventId?: string;
    // Prefill from a capture entry point (daily report, weather reschedule).
    cause?: string;
    firstObservedDate?: string;
    description?: string;
    claimedDays?: string;
    evidenceKind?: string;
    evidenceId?: string;
    evidenceAt?: string;
    autoLog?: string;
  }>();

  const {
    projects, updateProject,
    delayEvents, addDelayEvent, updateDelayEvent, getDelayEventsForProject,
    getPhotosForProject, getDailyReportsForProject, getRFIsForProject,
    getFieldTicketsForProject, getChangeOrdersForProject,
  } = useProjects();

  const projectId = params.projectId ?? projects[0]?.id ?? '';
  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const events = useMemo(
    () => (projectId ? getDelayEventsForProject(projectId) : []),
    [projectId, getDelayEventsForProject],
  );

  const period = effectiveNoticePeriod(project);

  const statuses = useMemo(
    () => buildNoticeStatus({
      events: delayEvents,
      projects: projects as Project[],
      nowMs: Date.now(),
      includeGiven: true,
    }),
    [delayEvents, projects],
  );
  const statusByEvent = useMemo(() => {
    const m = new Map<string, NoticeStatus>();
    for (const s of statuses) m.set(s.eventId, s);
    return m;
  }, [statuses]);
  const summary = useMemo(
    () => noticeSummary(statuses.filter((s) => s.projectId === projectId)),
    [statuses, projectId],
  );

  // ── Modal state ───────────────────────────────────────────────────────────
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [openEventId, setOpenEventId] = useState<string | null>(params.delayEventId ?? null);
  const [showNoticeForm, setShowNoticeForm] = useState(false);
  const [showEvidencePicker, setShowEvidencePicker] = useState(false);

  const openEvent = useMemo(
    () => events.find((e) => e.id === openEventId) ?? null,
    [events, openEventId],
  );

  // ── The log-a-delay form ──────────────────────────────────────────────────
  const [formCause, setFormCause] = useState<DelayCause>('other');
  const [formDate, setFormDate] = useState(todayISO());
  const [formDesc, setFormDesc] = useState('');
  const [formClaimed, setFormClaimed] = useState('');
  const [formConcurrent, setFormConcurrent] = useState('');
  const [pendingEvidence, setPendingEvidence] = useState<DelayEvidenceRef[]>([]);

  const resetForm = useCallback(() => {
    setFormCause('other');
    setFormDate(todayISO());
    setFormDesc('');
    setFormClaimed('');
    setFormConcurrent('');
    setPendingEvidence([]);
  }, []);

  // Prefill + auto-open from a capture entry point. Runs once per param set.
  const prefillKey = `${params.autoLog ?? ''}|${params.evidenceId ?? ''}|${params.firstObservedDate ?? ''}`;
  useEffect(() => {
    if (params.autoLog !== '1') return;
    setFormCause((CAUSES as string[]).includes(params.cause ?? '') ? (params.cause as DelayCause) : 'other');
    setFormDate(params.firstObservedDate ?? todayISO());
    setFormDesc(params.description ?? '');
    setFormClaimed(params.claimedDays ?? '');
    setPendingEvidence(
      params.evidenceKind && params.evidenceId
        ? [{
            kind: params.evidenceKind as DelayEvidenceKind,
            id: params.evidenceId,
            capturedAt: params.evidenceAt ?? new Date().toISOString(),
          }]
        : [],
    );
    setShowLogModal(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey]);

  const haptic = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  // ── §3.3 — the contract notice period ─────────────────────────────────────
  // Setting it is a project-level write. `assumed` marks the "I don't know"
  // path so every downstream deadline can be labelled.
  const setNoticePeriod = useCallback((days: number | null, assumed: boolean) => {
    if (!project) return;
    updateProject(project.id, {
      noticePeriodDays: days ?? undefined,
      noticePeriodAssumed: assumed,
    });
    setShowPeriodModal(false);
  }, [project, updateProject]);

  const setRequiredMethod = useCallback((m: DelayNoticeMethod | undefined) => {
    if (!project) return;
    updateProject(project.id, { noticeMethodRequired: m });
  }, [project, updateProject]);

  // ── Save a delay event ────────────────────────────────────────────────────
  const saveEvent = useCallback(() => {
    if (!projectId) {
      showAlert('Pick a project first', 'A delay event has to belong to a job.');
      return;
    }
    if (!formDesc.trim()) {
      showAlert('Describe the delay', 'One sentence is enough — what happened, and to what.');
      return;
    }
    const now = new Date().toISOString();
    const event: DelayEvent = {
      id: generateUUID(),
      projectId,
      number: nextDelayEventNumber(events),
      cause: formCause,
      firstObservedDate: formDate,
      description: formDesc.trim(),
      evidence: pendingEvidence,
      impactedTaskIds: [],
      claimedDays: toInt(formClaimed),
      concurrentDays: formConcurrent.trim() ? toInt(formConcurrent) : undefined,
      notices: [],
      // §1.3 / §5.3 — the app does NOT guess entitlement. A suggestion is
      // offered on the event card; nothing is decided here.
      classification: 'unclassified',
      createdAt: now,
      updatedAt: now,
    };
    addDelayEvent(event);
    resetForm();
    setShowLogModal(false);

    // §3.3 — the FIRST delay event on a project with no notice period BLOCKS on
    // the ask. Not a toast, not a badge: without the period there is no clock,
    // and a delay register with no clock is the exact thing this feature exists
    // to prevent.
    //
    // It also takes precedence over opening the event detail, so exactly ONE
    // modal transitions per tick — presenting two while a third dismisses is
    // the iOS stacking bug, and losing this prompt is losing the feature.
    if (period.days === null) {
      setShowPeriodModal(true);
      return;
    }
    setOpenEventId(event.id);
  }, [projectId, formDesc, formCause, formDate, formClaimed, formConcurrent, pendingEvidence, events, addDelayEvent, resetForm, period.days]);

  // ── Evidence ──────────────────────────────────────────────────────────────
  // Every entry is a POINTER — {kind, id, capturedAt}. Nothing is copied: a
  // copy is a second version of a fact that can drift from the first.
  const availableEvidence = useMemo<DelayEvidenceRef[]>(() => {
    if (!projectId) return [];
    const out: DelayEvidenceRef[] = [];
    for (const p of getPhotosForProject(projectId)) {
      out.push({ kind: 'photo', id: p.id, capturedAt: p.timestamp, note: p.location ?? p.tag });
    }
    for (const r of getDailyReportsForProject(projectId)) {
      out.push({ kind: 'daily_report', id: r.id, capturedAt: r.date, note: r.issuesAndDelays?.slice(0, 60) || 'Daily report' });
    }
    for (const r of getRFIsForProject(projectId)) {
      out.push({ kind: 'rfi', id: r.id, capturedAt: r.dateSubmitted ?? r.createdAt, note: `RFI #${r.number}: ${r.subject}` });
    }
    for (const ft of getFieldTicketsForProject(projectId)) {
      out.push({ kind: 'field_ticket', id: ft.id, capturedAt: ft.date, note: `T&M-${String(ft.number).padStart(3, '0')} · ${ft.workDescription.slice(0, 40)}` });
    }
    for (const co of getChangeOrdersForProject(projectId)) {
      out.push({ kind: 'change_order', id: co.id, capturedAt: co.date, note: `CO #${co.number}: ${(co.description ?? '').slice(0, 40)}` });
    }
    // Weather delay log lives on the schedule blob. `source` rides along in the
    // note so an entry can never be read as evidence without its provenance —
    // a 'mixed' entry contains days that came from SIMULATED weather and are
    // not admissible as delay documentation.
    for (const w of project?.schedule?.weatherDelayLog ?? []) {
      out.push({
        kind: 'weather_log',
        id: w.id,
        capturedAt: w.appliedAt,
        note: `${w.dates.length} evidenced day${w.dates.length === 1 ? '' : 's'} · source: ${w.source}${w.source === 'mixed' ? ' (some days simulated — excluded)' : ''}`,
      });
    }
    return out.sort((a, b) => (b.capturedAt ?? '').localeCompare(a.capturedAt ?? ''));
  }, [projectId, project, getPhotosForProject, getDailyReportsForProject, getRFIsForProject, getFieldTicketsForProject, getChangeOrdersForProject]);

  const attachEvidence = useCallback((ref: DelayEvidenceRef) => {
    haptic();
    if (openEvent) {
      const already = openEvent.evidence.some((e) => e.kind === ref.kind && e.id === ref.id);
      if (already) return;
      updateDelayEvent(openEvent.id, { evidence: [...openEvent.evidence, ref] });
    } else {
      setPendingEvidence((prev) =>
        prev.some((e) => e.kind === ref.kind && e.id === ref.id) ? prev : [...prev, ref]);
    }
  }, [openEvent, updateDelayEvent, haptic]);

  const detachEvidence = useCallback((ref: DelayEvidenceRef) => {
    if (openEvent) {
      updateDelayEvent(openEvent.id, {
        evidence: openEvent.evidence.filter((e) => !(e.kind === ref.kind && e.id === ref.id)),
      });
    } else {
      setPendingEvidence((prev) => prev.filter((e) => !(e.kind === ref.kind && e.id === ref.id)));
    }
  }, [openEvent, updateDelayEvent]);

  const openStatus = openEvent ? statusByEvent.get(openEvent.id) : undefined;

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
          <CalendarClock size={15} color={t.accent} strokeWidth={2} />
          <Text style={styles.headerTitle}>Delay register</Text>
        </View>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => { haptic(); resetForm(); setShowLogModal(true); }}
          accessibilityRole="button"
          accessibilityLabel="Log a delay"
          testID="delay-log-new"
        >
          <Plus size={20} color={t.accent} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.content, isDesktop && styles.contentDesktop]}>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>{project?.name ?? 'No project'}</Text>
            <Text style={styles.heroStat}>
              {events.length === 0
                ? 'No delays logged'
                : `${events.length} delay${events.length === 1 ? '' : 's'} on the record`}
            </Text>
            <Text style={styles.heroSub}>
              Every delay, dated, evidenced and notice-tracked. Most contracts make written
              notice a condition of any claim for time or money — a real claim can be waived
              purely on a missed window.
            </Text>
          </View>

          {/* ── §3.3 — the contract notice period ─────────────────────────── */}
          <TouchableOpacity
            style={[styles.card, period.days === null && styles.cardWarn]}
            onPress={() => { haptic(); setShowPeriodModal(true); }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Set the contract notice period"
            testID="notice-period-card"
          >
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, { backgroundColor: period.days === null ? t.warningSoft : t.accentSoft }]}>
                {period.days === null
                  ? <AlertTriangle size={14} color={t.warningLabel} strokeWidth={2} />
                  : <CalendarClock size={14} color={t.accent} strokeWidth={2} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>
                  {period.days === null
                    ? 'Set your contract notice period'
                    : `${period.days}-day written notice${period.assumed ? ` · ${ASSUMED_LABEL}` : ''}`}
                </Text>
                <Text style={styles.cardMeta}>
                  {period.days === null
                    ? NOTICE_PERIOD_QUESTION
                    : project?.noticeMethodRequired
                      ? `Delivery required: ${noticeMethodLabel(project.noticeMethodRequired)}`
                      : 'No required delivery method recorded'}
                </Text>
              </View>
              <ChevronRight size={14} color={t.textMuted} strokeWidth={2} />
            </View>
          </TouchableOpacity>

          {(summary.blown > 0 || summary.critical > 0 || summary.needsSecondNotice > 0) && (
            <View style={[styles.card, styles.cardDanger]}>
              <View style={styles.cardTop}>
                <View style={[styles.iconWrap, { backgroundColor: t.dangerSoft }]}>
                  <ShieldAlert size={14} color={t.dangerLabel} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>
                    {summary.blown > 0
                      ? `${summary.blown} notice window${summary.blown === 1 ? '' : 's'} closed`
                      : summary.critical > 0
                        ? `${summary.critical} notice${summary.critical === 1 ? '' : 's'} due within 3 days`
                        : `${summary.needsSecondNotice} awaiting an owner response`}
                  </Text>
                  <Text style={styles.cardMeta}>
                    A missed window can waive a claim you would have won — and you can still
                    owe liquidated damages on a delay that was not your fault.
                  </Text>
                </View>
              </View>
            </View>
          )}

          {events.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                Nothing logged yet. Log a delay from here, from a daily report&apos;s
                Issues &amp; Delays, or when you apply a weather reschedule.
              </Text>
            </View>
          ) : (
            <View style={isDesktop ? styles.cardGrid : undefined}>
              {events.map((e) => {
                const s = statusByEvent.get(e.id);
                const tone = s?.urgency === 'blown' || s?.urgency === 'critical'
                  ? t.dangerLabel
                  : s?.urgency === 'due_soon' || s?.urgency === 'unset'
                    ? t.warningLabel
                    : t.textSecondary;
                return (
                  <TouchableOpacity
                    key={e.id}
                    style={[styles.card, isDesktop && styles.cardDesktop]}
                    onPress={() => { haptic(); setOpenEventId(e.id); }}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${formatDelayEventNumber(e.number)}`}
                    testID={`delay-event-${e.id}`}
                  >
                    <View style={styles.cardTop}>
                      <View style={[styles.iconWrap, { backgroundColor: tone + '22' }]}>
                        <CalendarClock size={14} color={tone} strokeWidth={2} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {formatDelayEventNumber(e.number)} · {CAUSE_LABEL[e.cause]}
                        </Text>
                        <Text style={styles.cardMeta} numberOfLines={2}>{e.description}</Text>
                      </View>
                      <ChevronRight size={14} color={t.textMuted} strokeWidth={2} />
                    </View>

                    <View style={styles.metaRow}>
                      <Text style={styles.metaChip}>First observed {e.firstObservedDate}</Text>
                      <Text style={styles.metaChip}>{e.claimedDays}d claimed</Text>
                      {typeof e.concurrentDays === 'number' && e.concurrentDays > 0 && (
                        <Text style={styles.metaChip}>{e.concurrentDays}d concurrent</Text>
                      )}
                      <Text style={styles.metaChip}>{e.evidence.length} evidence</Text>
                    </View>

                    {s && (
                      <Text style={[styles.noticeLine, { color: tone }]} numberOfLines={2}>
                        {s.headline}
                      </Text>
                    )}
                    {s?.methodWarning && (
                      <Text style={styles.warnLine}>{s.methodWarning}</Text>
                    )}
                    {s?.accelerationPrompt && (
                      <Text style={styles.warnLine}>{s.accelerationPrompt}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <Text style={styles.footNote}>
            MAGE assembles and narrates. It does not decide entitlement, and recording a
            notice here is not the same act as serving it under your contract.
          </Text>
        </View>
      </ScrollView>

      {/* ── §3.3 The ask ──────────────────────────────────────────────────── */}
      <NoticePeriodModal
        visible={showPeriodModal}
        styles={styles}
        colors={t}
        project={project}
        onClose={() => setShowPeriodModal(false)}
        onPick={setNoticePeriod}
        onPickMethod={setRequiredMethod}
      />

      {/* ── Log a delay ───────────────────────────────────────────────────── */}
      <Modal visible={showLogModal} animationType="slide" transparent={false} onRequestClose={() => setShowLogModal(false)}>
        <View style={[styles.root, { paddingTop: insets.top }]}>
          <View style={styles.headerBar}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setShowLogModal(false)} accessibilityRole="button" accessibilityLabel="Close">
              <ChevronLeft size={22} color={t.text} strokeWidth={2} />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}><Text style={styles.headerTitle}>Log a delay</Text></View>
            <View style={styles.backBtn} />
          </View>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={[styles.content, isDesktop && styles.contentDesktop]}>
              <Text style={styles.fieldLabel}>What caused it</Text>
              <View style={styles.chipWrap}>
                {CAUSES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, formCause === c && styles.chipActive]}
                    onPress={() => { haptic(); setFormCause(c); }}
                    accessibilityRole="button"
                    accessibilityLabel={CAUSE_LABEL[c]}
                  >
                    <Text style={[styles.chipText, formCause === c && styles.chipTextActive]}>{CAUSE_LABEL[c]}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Date you first knew</Text>
              <Text style={styles.fieldHint}>
                This starts the notice clock — not the day you got round to typing it up.
              </Text>
              <TextInput
                style={styles.input}
                value={formDate}
                onChangeText={setFormDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={t.textMuted}
                autoCapitalize="none"
                testID="delay-first-observed"
              />

              <Text style={styles.fieldLabel}>What happened</Text>
              <TextInput
                style={[styles.input, styles.inputArea]}
                value={formDesc}
                onChangeText={setFormDesc}
                placeholder="The owner stopped the framing crew to re-decide the stair location."
                placeholderTextColor={t.textMuted}
                multiline
                textAlignVertical="top"
                testID="delay-description"
              />

              <Text style={styles.fieldLabel}>Days claimed</Text>
              <TextInput
                style={styles.input}
                value={formClaimed}
                onChangeText={setFormClaimed}
                placeholder="0"
                placeholderTextColor={t.textMuted}
                keyboardType="number-pad"
                testID="delay-claimed-days"
              />

              <Text style={styles.fieldLabel}>Days another delay ran concurrently</Text>
              <Text style={styles.fieldHint}>
                Optional, and worth being honest about. When your own delay overlaps the
                owner&apos;s, the usual US rule gives you the time but not the money — a
                register that can&apos;t show it gets taken apart in one question.
              </Text>
              <TextInput
                style={styles.input}
                value={formConcurrent}
                onChangeText={setFormConcurrent}
                placeholder="0"
                placeholderTextColor={t.textMuted}
                keyboardType="number-pad"
                testID="delay-concurrent-days"
              />

              <EvidenceStrip
                refs={pendingEvidence}
                styles={styles}
                colors={t}
                onAdd={() => setShowEvidencePicker(true)}
                onRemove={detachEvidence}
              />

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={saveEvent}
                accessibilityRole="button"
                accessibilityLabel="Save delay event"
                testID="delay-save"
              >
                <Check size={15} color={Colors.textOnAccent} strokeWidth={2.4} />
                <Text style={styles.primaryBtnText}>Log it</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Event detail ──────────────────────────────────────────────────── */}
      <Modal visible={openEvent !== null && !showLogModal} animationType="slide" transparent={false} onRequestClose={() => setOpenEventId(null)}>
        {openEvent && (
          <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.headerBar}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setOpenEventId(null)} accessibilityRole="button" accessibilityLabel="Close">
                <ChevronLeft size={22} color={t.text} strokeWidth={2} />
              </TouchableOpacity>
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTitle}>{formatDelayEventNumber(openEvent.number)}</Text>
              </View>
              <View style={styles.backBtn} />
            </View>
            <ScrollView contentContainerStyle={styles.scroll}>
              <View style={[styles.content, isDesktop && styles.contentDesktop]}>
                <Text style={styles.heroStat}>{CAUSE_LABEL[openEvent.cause]}</Text>
                <Text style={styles.heroSub}>{openEvent.description}</Text>

                {openStatus && (
                  <View style={[styles.card, openStatus.urgency === 'blown' && styles.cardDanger]}>
                    <Text style={styles.cardTitle}>{openStatus.headline}</Text>
                    <Text style={styles.cardMeta}>{openStatus.detail}</Text>
                    {openStatus.deadlineDate && (
                      <Text style={styles.cardMeta}>
                        Derived from {openStatus.firstObservedDate} + your {openStatus.noticePeriodDays}-day
                        contract setting{openStatus.assumed ? ` (${ASSUMED_LABEL})` : ''}.
                      </Text>
                    )}
                    {openStatus.methodWarning && <Text style={styles.warnLine}>{openStatus.methodWarning}</Text>}
                    {openStatus.accelerationPrompt && <Text style={styles.warnLine}>{openStatus.accelerationPrompt}</Text>}
                  </View>
                )}

                {/* §5.3 — SUGGEST, NEVER CONCLUDE. */}
                <Text style={styles.fieldLabel}>Your classification</Text>
                <Text style={styles.fieldHint}>
                  Yours to assert, not ours to decide. We can suggest a starting point from the
                  cause; the call is yours and your attorney&apos;s.
                </Text>
                <View style={styles.chipWrap}>
                  {CLASSIFICATIONS.map((c) => {
                    const suggested = suggestClassification(openEvent.cause) === c && c !== 'unclassified';
                    const active = openEvent.classification === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => { haptic(); updateDelayEvent(openEvent.id, { classification: c }); }}
                        accessibilityRole="button"
                        accessibilityLabel={CLASSIFICATION_LABEL[c]}
                        testID={`delay-classification-${c}`}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {CLASSIFICATION_LABEL[c]}{suggested && !active ? ' · suggested' : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <EvidenceStrip
                  refs={openEvent.evidence}
                  styles={styles}
                  colors={t}
                  onAdd={() => setShowEvidencePicker(true)}
                  onRemove={detachEvidence}
                />

                <Text style={styles.fieldLabel}>Notices</Text>
                <Text style={styles.fieldHint}>{RECORDING_IS_NOT_SERVING}</Text>
                {openEvent.notices.length === 0 ? (
                  <Text style={styles.emptyText}>No notice recorded yet.</Text>
                ) : (
                  openEvent.notices.map((n) => (
                    <View key={n.id} style={styles.noticeRow}>
                      <Text style={styles.cardTitle}>{NOTICE_KIND_LABEL[n.kind]}</Text>
                      <Text style={styles.cardMeta}>
                        {n.sentAt.slice(0, 10)} · {noticeMethodLabel(n.method)} · to {n.recipient || 'unspecified'}
                        {typeof n.daysRequested === 'number' ? ` · ${n.daysRequested}d requested` : ''}
                      </Text>
                      {n.kind === 'reservation_of_rights' && (
                        <Text style={styles.cardMeta}>
                          Reserved: {n.reservedClaimDescription}
                          {typeof n.reservedAmount === 'number' && n.reservedAmount > 0 ? ` · $${n.reservedAmount}` : ''}
                          {typeof n.reservedDaysClaimed === 'number' && n.reservedDaysClaimed > 0 ? ` · ${n.reservedDaysClaimed}d` : ''}
                        </Text>
                      )}
                      {noticeMethodWarning(project?.noticeMethodRequired, n.method) && (
                        <Text style={styles.warnLine}>{noticeMethodWarning(project?.noticeMethodRequired, n.method)}</Text>
                      )}
                    </View>
                  ))
                )}

                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => { haptic(); setShowNoticeForm(true); }}
                  accessibilityRole="button"
                  accessibilityLabel="Record a notice"
                  testID="delay-record-notice"
                >
                  <Send size={15} color={Colors.textOnAccent} strokeWidth={2.2} />
                  <Text style={styles.primaryBtnText}>Record a notice</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>

      {/* ── Record a notice ───────────────────────────────────────────────── */}
      <NoticeFormModal
        visible={showNoticeForm && openEvent !== null}
        styles={styles}
        colors={t}
        insetTop={insets.top}
        requiredMethod={project?.noticeMethodRequired}
        onClose={() => setShowNoticeForm(false)}
        onSave={(notice) => {
          if (!openEvent) return;
          updateDelayEvent(openEvent.id, { notices: [...openEvent.notices, notice] });
          setShowNoticeForm(false);
        }}
      />

      {/* ── Attach evidence ───────────────────────────────────────────────── */}
      <Modal visible={showEvidencePicker} animationType="slide" transparent={false} onRequestClose={() => setShowEvidencePicker(false)}>
        <View style={[styles.root, { paddingTop: insets.top }]}>
          <View style={styles.headerBar}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setShowEvidencePicker(false)} accessibilityRole="button" accessibilityLabel="Close">
              <ChevronLeft size={22} color={t.text} strokeWidth={2} />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}><Text style={styles.headerTitle}>Attach evidence</Text></View>
            <View style={styles.backBtn} />
          </View>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={[styles.content, isDesktop && styles.contentDesktop]}>
              <Text style={styles.fieldHint}>
                Evidence is linked, never copied — the original record stays the authority, so
                nothing here can drift out of step with it.
              </Text>
              {availableEvidence.length === 0 ? (
                <Text style={styles.emptyText}>Nothing captured on this job yet.</Text>
              ) : availableEvidence.map((ref) => {
                const Icon = EVIDENCE_ICON[ref.kind];
                return (
                  <TouchableOpacity
                    key={`${ref.kind}:${ref.id}`}
                    style={styles.noticeRow}
                    onPress={() => attachEvidence(ref)}
                    accessibilityRole="button"
                    accessibilityLabel={`Attach ${EVIDENCE_KIND_LABEL[ref.kind]}`}
                    testID={`evidence-${ref.kind}-${ref.id}`}
                  >
                    <View style={styles.cardTop}>
                      <View style={[styles.iconWrap, { backgroundColor: t.surfaceAlt }]}>
                        <Icon size={14} color={t.textSecondary} strokeWidth={2} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{EVIDENCE_KIND_LABEL[ref.kind]}</Text>
                        <Text style={styles.cardMeta} numberOfLines={2}>
                          {(ref.capturedAt ?? '').slice(0, 10)}{ref.note ? ` · ${ref.note}` : ''}
                        </Text>
                      </View>
                      <Plus size={14} color={t.accent} strokeWidth={2.2} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// §3.3 — the notice-period ask
// ---------------------------------------------------------------------------

function NoticePeriodModal({
  visible, styles, colors: t, project, onClose, onPick, onPickMethod,
}: {
  visible: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  project: Project | undefined;
  onClose: () => void;
  onPick: (days: number | null, assumed: boolean) => void;
  onPickMethod: (m: DelayNoticeMethod | undefined) => void;
}) {
  const [custom, setCustom] = useState('');
  const current = effectiveNoticePeriod(project);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.headerTitle}>Written-notice period</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}>
              <XIcon size={18} color={t.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <ScrollView>
            <Text style={styles.fieldHint}>{NOTICE_PERIOD_QUESTION}</Text>
            <Text style={styles.fieldHint}>
              We deliberately don&apos;t assume one. Guessing 21 days when your contract says 7
              would hand you a clock that runs two weeks long and a false sense of safety.
            </Text>

            <View style={styles.chipWrap}>
              {NOTICE_PERIOD_PRESETS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.chip, current.days === d && !current.assumed && styles.chipActive]}
                  onPress={() => onPick(d, false)}
                  accessibilityRole="button"
                  accessibilityLabel={`${d} days`}
                  testID={`notice-period-${d}`}
                >
                  <Text style={[styles.chipText, current.days === d && !current.assumed && styles.chipTextActive]}>
                    {d} days
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.chip}
                onPress={() => onPick(ASSUMED_NOTICE_PERIOD_DAYS, true)}
                accessibilityRole="button"
                accessibilityLabel="I don't know"
                testID="notice-period-unknown"
              >
                <Text style={styles.chipText}>I don&apos;t know</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldHint}>
              &quot;I don&apos;t know&quot; sets a conservative {ASSUMED_NOTICE_PERIOD_DAYS} days and labels every
              deadline &quot;{ASSUMED_LABEL}&quot;.
            </Text>

            <Text style={styles.fieldLabel}>Or enter it exactly</Text>
            <View style={styles.inlineRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={custom}
                onChangeText={setCustom}
                placeholder="Days"
                placeholderTextColor={t.textMuted}
                keyboardType="number-pad"
                testID="notice-period-custom"
              />
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => { const n = toInt(custom); if (n > 0) onPick(n, false); }}
                accessibilityRole="button"
                accessibilityLabel="Save custom notice period"
              >
                <Text style={styles.secondaryBtnText}>Save</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Delivery your contract requires</Text>
            <Text style={styles.fieldHint}>
              AIA A201-2017 §15.1.3.2 calls for certified or registered mail, or a courier with
              proof of delivery. Set it and we&apos;ll flag a notice logged through a channel
              that may not satisfy the clause.
            </Text>
            <View style={styles.chipWrap}>
              {METHODS.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.chip, project?.noticeMethodRequired === m && styles.chipActive]}
                  onPress={() => onPickMethod(project?.noticeMethodRequired === m ? undefined : m)}
                  accessibilityRole="button"
                  accessibilityLabel={noticeMethodLabel(m)}
                  testID={`notice-method-required-${m}`}
                >
                  <Text style={[styles.chipText, project?.noticeMethodRequired === m && styles.chipTextActive]}>
                    {noticeMethodLabel(m)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {current.days !== null && (
              <Text style={styles.fieldHint}>
                Example: a delay first observed {todayISO()} would need notice by{' '}
                {noticeDeadline(todayISO(), current.days)}.
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Record a notice — where Mingus and Zafer are enforced
// ---------------------------------------------------------------------------

function NoticeFormModal({
  visible, styles, colors: t, insetTop, requiredMethod, onClose, onSave,
}: {
  visible: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  insetTop: number;
  requiredMethod: DelayNoticeMethod | undefined;
  onClose: () => void;
  onSave: (n: DelayNotice) => void;
}) {
  const [kind, setKind] = useState<DelayNotice['kind']>('initial');
  const [method, setMethod] = useState<DelayNoticeMethod>('certified_mail');
  const [recipient, setRecipient] = useState('');
  const [days, setDays] = useState('');
  const [resDesc, setResDesc] = useState('');
  const [resAmount, setResAmount] = useState('');
  const [resDays, setResDays] = useState('');

  const draft: DelayNotice = {
    id: 'draft',
    kind,
    sentAt: new Date().toISOString(),
    method,
    recipient: recipient.trim(),
    daysRequested: days.trim() ? toInt(days) : undefined,
    reservedClaimDescription: resDesc.trim() || undefined,
    reservedAmount: resAmount.trim() ? toInt(resAmount) : undefined,
    reservedDaysClaimed: resDays.trim() ? toInt(resDays) : undefined,
  };
  const violations = noticeViolations(draft);
  const methodWarn = noticeMethodWarning(requiredMethod, method);

  const save = () => {
    if (violations.length > 0) {
      showAlert(
        'This notice needs more',
        `Add ${violations.join(', and ')}.`,
      );
      return;
    }
    onSave({ ...draft, id: generateUUID() });
    setRecipient(''); setDays(''); setResDesc(''); setResAmount(''); setResDays('');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insetTop }]}>
        <View style={styles.headerBar}>
          <TouchableOpacity style={styles.backBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <ChevronLeft size={22} color={t.text} strokeWidth={2} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}><Text style={styles.headerTitle}>Record a notice</Text></View>
          <View style={styles.backBtn} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.content}>
            <Text style={styles.fieldHint}>{RECORDING_IS_NOT_SERVING}</Text>

            <Text style={styles.fieldLabel}>What kind</Text>
            <View style={styles.chipWrap}>
              {NOTICE_KINDS.map((k) => (
                <TouchableOpacity
                  key={k}
                  style={[styles.chip, kind === k && styles.chipActive]}
                  onPress={() => setKind(k)}
                  accessibilityRole="button"
                  accessibilityLabel={NOTICE_KIND_LABEL[k]}
                  testID={`notice-kind-${k}`}
                >
                  <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>{NOTICE_KIND_LABEL[k]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {kind === 'supplemental' && (
              <Text style={styles.fieldHint}>
                The second notice. If the owner sat on your extension request and still holds
                you to the original date, you have to tell them in writing that you regard that
                as acceleration — it is a separate element of the claim, and it is the one
                almost everybody forgets.
              </Text>
            )}

            <Text style={styles.fieldLabel}>How it went out</Text>
            <View style={styles.chipWrap}>
              {METHODS.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.chip, method === m && styles.chipActive]}
                  onPress={() => setMethod(m)}
                  accessibilityRole="button"
                  accessibilityLabel={noticeMethodLabel(m)}
                  testID={`notice-method-${m}`}
                >
                  <Text style={[styles.chipText, method === m && styles.chipTextActive]}>{noticeMethodLabel(m)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {methodWarn && <Text style={styles.warnLine}>{methodWarn}</Text>}

            <Text style={styles.fieldLabel}>Who you sent it to</Text>
            <TextInput
              style={styles.input}
              value={recipient}
              onChangeText={setRecipient}
              placeholder="Owner's rep, architect, name on the contract"
              placeholderTextColor={t.textMuted}
              testID="notice-recipient"
            />

            {kind !== 'reservation_of_rights' ? (
              <>
                <Text style={styles.fieldLabel}>Days of extension requested</Text>
                <Text style={styles.fieldHint}>
                  Required. An open-ended request for &quot;an appropriate extension&quot; is not a
                  sufficient request — it fails the claim on its own.
                </Text>
                <TextInput
                  style={styles.input}
                  value={days}
                  onChangeText={setDays}
                  placeholder="e.g. 8"
                  placeholderTextColor={t.textMuted}
                  keyboardType="number-pad"
                  testID="notice-days-requested"
                />
              </>
            ) : (
              <>
                {/* Mingus: "specific claims … excepted in stated amounts." A
                    generic "reserves all rights" is a blunderbuss exception and
                    insufficient as a matter of law — so this is three fields,
                    not a checkbox and a notes box. */}
                <Text style={styles.fieldLabel}>Which claim you are reserving</Text>
                <Text style={styles.fieldHint}>
                  Name it specifically. Generic &quot;reserves all rights&quot; language has been held
                  insufficient as a matter of law — the exception has to identify the claim and
                  state an amount.
                </Text>
                <TextInput
                  style={[styles.input, styles.inputArea]}
                  value={resDesc}
                  onChangeText={setResDesc}
                  placeholder="Acceleration costs for the May stair re-work, not included in this change order."
                  placeholderTextColor={t.textMuted}
                  multiline
                  textAlignVertical="top"
                  testID="notice-reserved-description"
                />
                <Text style={styles.fieldLabel}>Amount reserved ($)</Text>
                <TextInput
                  style={styles.input}
                  value={resAmount}
                  onChangeText={setResAmount}
                  placeholder="0"
                  placeholderTextColor={t.textMuted}
                  keyboardType="number-pad"
                  testID="notice-reserved-amount"
                />
                <Text style={styles.fieldLabel}>Days reserved</Text>
                <TextInput
                  style={styles.input}
                  value={resDays}
                  onChangeText={setResDays}
                  placeholder="0"
                  placeholderTextColor={t.textMuted}
                  keyboardType="number-pad"
                  testID="notice-reserved-days"
                />
              </>
            )}

            {violations.length > 0 && (
              <Text style={styles.warnLine}>Still needed: {violations.join('; ')}.</Text>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, violations.length > 0 && styles.primaryBtnDisabled]}
              onPress={save}
              accessibilityRole="button"
              accessibilityLabel="Save notice"
              testID="notice-save"
            >
              <Check size={15} color={Colors.textOnAccent} strokeWidth={2.4} />
              <Text style={styles.primaryBtnText}>Record it</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function EvidenceStrip({
  refs, styles, colors: t, onAdd, onRemove,
}: {
  refs: DelayEvidenceRef[];
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  onAdd: () => void;
  onRemove: (r: DelayEvidenceRef) => void;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>Evidence ({refs.length})</Text>
      {refs.map((r) => {
        const Icon = EVIDENCE_ICON[r.kind];
        return (
          <View key={`${r.kind}:${r.id}`} style={styles.evidenceRow}>
            <Icon size={13} color={t.textSecondary} strokeWidth={2} />
            <Text style={styles.evidenceText} numberOfLines={1}>
              {EVIDENCE_KIND_LABEL[r.kind]} · {(r.capturedAt ?? '').slice(0, 10)}
              {r.note ? ` · ${r.note}` : ''}
            </Text>
            <TouchableOpacity
              onPress={() => onRemove(r)}
              hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Remove evidence"
            >
              <XIcon size={13} color={t.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        );
      })}
      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel="Attach evidence"
        testID="delay-attach-evidence"
      >
        <Paperclip size={13} color={t.accent} strokeWidth={2.2} />
        <Text style={styles.secondaryBtnText}>Attach evidence</Text>
      </TouchableOpacity>
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
    headerTitle: { ...Type.headline, color: t.text },
    scroll: { paddingBottom: 48 },
    content: {
      width: '100%',
      alignSelf: 'center',
      paddingHorizontal: Tokens.spacing.md,
      paddingTop: Tokens.spacing.lg,
    },
    contentDesktop: { maxWidth: 1100, paddingHorizontal: Tokens.spacing.lg },
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
    card: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      marginBottom: Tokens.spacing.sm,
    },
    cardWarn: { borderColor: t.warningLabel },
    cardDanger: { borderColor: t.dangerLabel },
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
    cardMeta: { ...Type.caption1, color: t.textSecondary, marginTop: 2 },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Tokens.spacing.xs },
    metaChip: {
      ...Type.caption2,
      color: t.textSecondary,
      backgroundColor: t.surfaceAlt,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: Tokens.radius.full,
      overflow: 'hidden',
    },
    noticeLine: { ...Type.caption1, fontWeight: '700', marginTop: Tokens.spacing.xs },
    warnLine: { ...Type.caption1, color: t.warningLabel, marginTop: Tokens.spacing.xs, lineHeight: 17 },
    footNote: { ...Type.caption2, color: t.textMuted, marginTop: Tokens.spacing.lg, lineHeight: 15 },
    emptyCard: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
    },
    emptyText: { ...Type.footnote, color: t.textSecondary },
    fieldLabel: { ...Type.footnoteEmphasized, color: t.text, marginTop: Tokens.spacing.md },
    fieldHint: { ...Type.caption1, color: t.textSecondary, marginTop: 2, lineHeight: 17 },
    input: {
      ...Type.subhead,
      color: t.text,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.md,
      paddingHorizontal: Tokens.spacing.sm,
      paddingVertical: 10,
      marginTop: Tokens.spacing.xs,
    },
    inputArea: { minHeight: 84 },
    inlineRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Tokens.spacing.xs },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: Tokens.radius.full,
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.line,
    },
    chipActive: { backgroundColor: t.accent, borderColor: t.accent },
    chipText: { ...Type.caption1, color: t.textSecondary },
    chipTextActive: { color: Colors.textOnAccent, fontWeight: '700' },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: Tokens.spacing.md,
      paddingVertical: 12,
      borderRadius: Tokens.radius.md,
      backgroundColor: t.accent,
    },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: { ...Type.footnoteEmphasized, color: Colors.textOnAccent },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: Tokens.spacing.xs,
      paddingVertical: 10,
      paddingHorizontal: Tokens.spacing.sm,
      borderRadius: Tokens.radius.md,
      borderWidth: 1,
      borderColor: t.accentSoft,
      backgroundColor: t.surfaceAlt,
    },
    secondaryBtnText: { ...Type.caption1, color: t.accent, fontWeight: '700' },
    noticeRow: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.md,
      padding: Tokens.spacing.sm,
      marginTop: Tokens.spacing.xs,
    },
    evidenceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    evidenceText: { ...Type.caption1, color: t.textSecondary, flex: 1 },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: t.bg,
      borderTopLeftRadius: Tokens.radius.xl,
      borderTopRightRadius: Tokens.radius.xl,
      padding: Tokens.spacing.md,
      maxHeight: '86%',
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Tokens.spacing.sm,
    },
  });
