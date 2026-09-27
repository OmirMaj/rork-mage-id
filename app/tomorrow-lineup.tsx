// Tomorrow's lineup — one ready-to-send text per sub for the next working day.
//
// Reads the job's schedule, deliveries, building access slots and permit
// inspections (utils/tomorrowLineup) and drafts each sub's message. Every draft
// is editable, and nothing leaves the phone until he taps that sub's Send.
// UX wave B4: Send opens Messages ADDRESSED to the sub with the whole text
// (utils/lineupTexts → Lane 0's smsUrl); a sub with no phone gets the share
// sheet (shareText, with the text shown to copy if sharing is unavailable).
// "Text all N" steps through the subs one at a time. A row then reads
// "Opened in Messages" — never "Sent": iOS gives no signal that he pressed
// Send, and nothing here records the lineup as delivered. On web the screen
// asks "Did you send it?" first (work-order.tsx's pattern). Nothing sends in
// the background.
//
// Gated on 'schedule_gantt_pdf' — the key Last Planner (its door) checks —
// through useProjectAccess, so a collaborator's grant on the job counts.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Platform, Linking } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Send, AlertTriangle } from 'lucide-react-native';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Card, Button, ScreenHeader } from '@/components/ui';
import Paywall from '@/components/Paywall';
import DatePickerModal from '@/components/DatePickerModal';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useActiveProject } from '@/contexts/ActiveProjectContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { shareText } from '@/utils/shareText';
import { formatCalendarDay } from '@/utils/calendarDate';
import { buildLineup, nextWorkingDay, lineupHeadline, type LineupSub } from '@/utils/tomorrowLineup';
import {
  lineupSendRoute, lineupRowStatusLabel, queueAfter, queueBanner, textAllLabel, NO_PHONE_NOTE, type LineupRowStatus,
} from '@/utils/lineupTexts';
import { armLineupReminder, disarmLineupReminder, isLineupReminderArmed, lineupReminderCopy } from '@/utils/lineupReminder';

export default function TomorrowLineupScreen() {
  const router = useRouter();
  // Project-aware (useProjectAccess): a collaborator on the GC's job reads the
  // lineup on the GC's plan, the same grant the schedule itself carries.
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { activeProjectId } = useActiveProject();
  const { canAccess, requiredTierFor } = useProjectAccess(paramProjectId ?? activeProjectId ?? undefined);
  if (!canAccess('schedule_gantt_pdf')) {
    return (
      <Paywall visible feature="Last Planner" requiredTier={requiredTierFor('schedule_gantt_pdf')} onClose={() => router.back()} />
    );
  }
  return <TomorrowLineupInner />;
}

function TomorrowLineupInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, getProject, subcontractors, commitments, deliveries, accessReservations, permits,
  } = useProjects();

  const { activeProjectId } = useActiveProject();
  const now = useMemo(() => new Date(), []);
  // His pick, else the route param, else the job he is working in, else the
  // only job he has — resolved every render so a list that hydrates after the
  // first paint still lands on a job.
  const [pickedProjectId, setProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? activeProjectId ?? (projects.length === 1 ? projects[0].id : null);
  const project = projectId ? getProject(projectId) ?? null : null;
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const date = pickedDate ?? nextWorkingDay(now, project?.schedule);
  const [picking, setPicking] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const lineup = useMemo(() => (project ? buildLineup({
    project: { id: project.id, name: project.name, location: project.location },
    date,
    schedule: project.schedule,
    subs: subcontractors,
    commitments,
    deliveries,
    accessReservations,
    permits,
    now,
  }) : null), [project, date, subcontractors, commitments, deliveries, accessReservations, permits, now]);

  const draftKey = (s: LineupSub) => `${projectId}:${date}:${s.sub.id}`;
  // What each row says after its Send (keyed like the drafts). Never "Sent".
  const [rowStatus, setRowStatus] = useState<Record<string, LineupRowStatus>>({});
  const markRow = useCallback((key: string, st: LineupRowStatus) => setRowStatus(r => ({ ...r, [key]: st })), []);

  const shareFallback = useCallback(async (s: LineupSub, message: string, key: string) => {
    try {
      const outcome = await shareText({ message, title: `Lineup — ${s.sub.name}` });
      if (outcome === 'copied') showAlert('Copied', 'Sharing is not available here, so the message is on your clipboard — paste it into a text or email.');
      else if (outcome === 'failed') showAlert('Send manually', message);
      else markRow(key, 'shared');
    } catch {
      showAlert('Send manually', message);
    }
  }, [markRow]);

  const send = useCallback(async (s: LineupSub, message: string, key: string) => {
    const route = lineupSendRoute(s.sub, message, Platform.OS);
    if (route.kind === 'share') { await shareFallback(s, message, key); return; }
    try {
      await Linking.openURL(route.url);
      // On web openURL resolves even with no sms: handler behind it (a desk
      // PC with no Messages app), so "it opened" proves nothing — ask.
      if (Platform.OS === 'web') {
        showAlert(
          'Did you send it?',
          `MAGE can't see your messages. Mark it only once the text has actually gone to ${s.sub.name}.`,
          [
            { text: 'Not sent', style: 'cancel', onPress: () => markRow(key, 'not_sent') },
            { text: 'Sent', onPress: () => markRow(key, 'marked_sent') },
          ],
        );
        return;
      }
      markRow(key, 'opened');
    } catch {
      // Messages would not open: the share sheet still gets it out.
      await shareFallback(s, message, key);
    }
  }, [shareFallback, markRow]);

  // "Text all N": one sub at a time. iOS opens one Messages sheet per tap, so
  // after each he comes back to this list and taps the next — the banner
  // names who is next. Nothing is sent without his tap on each.
  const [queue, setQueue] = useState<string[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const sendQueued = useCallback((id: string) => {
    const s = lineup?.perSub.find(x => x.sub.id === id);
    setQueue(q => queueAfter(q, id));
    if (!s) return;
    const key = draftKey(s);
    void send(s, drafts[key] ?? s.message, key);
  // draftKey reads projectId and date, both in the deps through lineup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineup, drafts, send]);
  const startTextAll = useCallback(() => {
    const ids = (lineup?.perSub ?? []).map(x => x.sub.id);
    if (ids.length === 0) return;
    setQueueTotal(ids.length);
    setQueue(ids);
    sendQueued(ids[0]);
  }, [lineup, sendQueued]);
  // A job or day switch drops the queue and the row labels: they belonged to
  // the other lineup.
  useEffect(() => { setQueue([]); setRowStatus({}); }, [projectId, date]);
  const nameOf = useCallback((id: string) => lineup?.perSub.find(x => x.sub.id === id)?.sub.name ?? 'the next sub', [lineup]);
  const banner = queueBanner(queue, queueTotal, nameOf);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="lineup-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        variant="tool"
        eyebrow={project?.name ?? 'Field'}
        title={lineupHeadline(now)}
        onBack={() => router.back()}
        testID="lineup-header"
      />
      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        <Text style={styles.sectionLabel}>Job</Text>
        {projects.length === 0 ? (
          <Text style={styles.muted}>No projects yet — create a project and build its schedule first.</Text>
        ) : (
          <View style={styles.chipRow}>
            {projects.map(p => {
              const on = p.id === projectId;
              return (
                <TouchableOpacity key={p.id} onPress={() => { setProjectId(p.id); setPickedDate(null); }} style={[styles.chip, on && styles.chipOn]} testID={`lineup-project-${p.id}`} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{p.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {project && lineup ? (
          <>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setPicking(true)} testID="lineup-date" accessibilityRole="button" accessibilityLabel="Change the day">
              <CalendarDays size={14} color={t.textSecondary} strokeWidth={1.75} />
              <Text style={styles.dateBtnText}>For {formatCalendarDay(date, { weekday: 'long', month: 'short', day: 'numeric' })} · change</Text>
            </TouchableOpacity>

            <LineupReminderRow />

            {lineup.emptyNote ? (
              <Card style={styles.card} testID="lineup-empty"><Text style={styles.body}>{lineup.emptyNote}</Text></Card>
            ) : null}
            {lineup.summary ? (
              <Card style={styles.card} testID="lineup-summary"><Text style={styles.summary}>{lineup.summary}</Text></Card>
            ) : null}

            {lineup.perSub.length > 1 ? (
              <Button
                label={textAllLabel(lineup.perSub.length)}
                onPress={startTextAll}
                iconLeft={<Send size={15} color={Colors.textOnAccent} strokeWidth={1.75} />}
                testID="lineup-text-all"
                fullWidth
              />
            ) : null}
            {banner ? (
              <Card style={styles.card} testID="lineup-queue">
                <Text style={styles.subName}>{banner}</Text>
                <View style={styles.row}>
                  <Button label="Text next" onPress={() => sendQueued(queue[0])} testID="lineup-queue-next" containerStyle={styles.flexBtn} />
                  <Button label="Stop" variant="secondary" onPress={() => setQueue([])} testID="lineup-queue-stop" containerStyle={styles.flexBtn} />
                </View>
              </Card>
            ) : null}

            {lineup.perSub.map(s => {
              const key = draftKey(s);
              const text = drafts[key] ?? s.message;
              const statusLabel = lineupRowStatusLabel(rowStatus[key]);
              const route = lineupSendRoute(s.sub, text, Platform.OS);
              return (
                <Card key={s.sub.id} style={styles.card} testID={`lineup-sub-${s.sub.id}`}>
                  <Text style={styles.subName}>{s.sub.name}</Text>
                  <Text style={styles.muted}>
                    {s.noContact ? 'No phone or email on file — Send opens the share sheet so you can pick how.' : [s.sub.phone, s.sub.email].filter(Boolean).join(' · ')}
                  </Text>
                  {!s.noContact && route.kind === 'share' ? (
                    <Text style={styles.muted} testID={`lineup-no-phone-${s.sub.id}`}>{NO_PHONE_NOTE}</Text>
                  ) : null}
                  <TextInput
                    value={text}
                    onChangeText={(v) => setDrafts(d => ({ ...d, [key]: v }))}
                    multiline
                    style={styles.draftInput}
                    accessibilityLabel={`Message to ${s.sub.name}`}
                    testID={`lineup-draft-${s.sub.id}`}
                  />
                  <Button
                    label={route.kind === 'sms' ? `Text ${s.sub.name}` : 'Send…'}
                    onPress={() => { void send(s, text, key); }}
                    iconLeft={<Send size={15} color={Colors.textOnAccent} strokeWidth={1.75} />}
                    testID={`lineup-send-${s.sub.id}`}
                    fullWidth
                  />
                  {statusLabel ? <Text style={styles.statusLine} testID={`lineup-status-${s.sub.id}`}>{statusLabel}</Text> : null}
                </Card>
              );
            })}

            {(lineup.siteWide.deliveries.length + lineup.siteWide.access.length + lineup.siteWide.inspections.length) > 0 ? (
              <Card style={styles.card} testID="lineup-sitewide">
                <Text style={styles.subName}>Site-wide</Text>
                {lineup.siteWide.access.map(a => <Text key={a.id} style={styles.body}>Access: {a.text}</Text>)}
                {lineup.siteWide.deliveries.map(d => <Text key={d.id} style={styles.body}>Delivery (not tied to a sub): {d.text}</Text>)}
                {lineup.siteWide.inspections.map(i => <Text key={i.id} style={styles.body}>{i.text}</Text>)}
              </Card>
            ) : null}

            {lineup.gaps.length > 0 ? (
              <Card style={styles.card} testID="lineup-gaps">
                <View style={styles.row}>
                  <AlertTriangle size={14} color={t.warningLabel} strokeWidth={1.75} />
                  <Text style={styles.subName}>Not in any message</Text>
                </View>
                {lineup.gaps.map((g, i) => <Text key={i} style={styles.body}>{g}</Text>)}
              </Card>
            ) : null}
          </>
        ) : projects.length > 0 ? (
          <Text style={styles.muted}>Pick a job to build its lineup.</Text>
        ) : null}
      </ScrollView>

      <DatePickerModal
        visible={picking}
        value={date}
        allowFuture
        title="Lineup for"
        onClose={() => setPicking(false)}
        onChange={(iso) => { setPickedDate(iso.slice(0, 10)); setPicking(false); }}
      />
    </View>
  );
}

/** The 3 pm weekday reminder toggle. Opt-in: the OS permission prompt comes
 *  only from his tap here. The OS schedule is the source of truth — read on
 *  mount, nothing stored. It sends nothing to any sub. */
type ReminderNote = 'noPermission' | 'failed' | 'readFailed' | null;
function LineupReminderRow() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isWeb = Platform.OS === 'web';
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<ReminderNote>(null);

  useEffect(() => {
    if (isWeb) return;
    let alive = true;
    void isLineupReminderArmed().then(armed => {
      if (!alive) return;
      setOn(armed === true);
      setNote(armed === null ? 'readFailed' : null);
    });
    return () => { alive = false; };
  }, [isWeb]);

  const toggle = useCallback(async (next: boolean) => {
    setBusy(true);
    try {
      if (next) {
        const res = await armLineupReminder({ prompt: true });
        setOn(res === 'armed');
        setNote(res === 'armed' ? null : res === 'no_permission' ? 'noPermission' : 'failed');
      } else {
        await disarmLineupReminder();
        setOn(false);
        setNote(null);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const status = isWeb ? lineupReminderCopy.web : note ? lineupReminderCopy[note] : null;
  return (
    <View style={styles.reminder} testID="lineup-reminder">
      <View style={styles.reminderRow}>
        <Text style={styles.reminderLabel}>{lineupReminderCopy.toggle}</Text>
        <Switch
          value={on}
          onValueChange={(v) => { void toggle(v); }}
          disabled={isWeb || busy}
          trackColor={{ false: t.line, true: t.accentFill }}
          testID="lineup-reminder-switch"
          accessibilityLabel={lineupReminderCopy.toggle}
        />
      </View>
      <Text style={styles.muted}>{lineupReminderCopy.help}</Text>
      {status ? <Text style={styles.reminderStatus} testID="lineup-reminder-status">{status}</Text> : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  sectionLabel: { ...Type.caption1, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.full, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, maxWidth: 260 },
  chipOn: { backgroundColor: t.text, borderColor: t.text },
  chipText: { ...Type.footnote, fontWeight: '700', color: t.text },
  chipTextOn: { color: t.bg },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, marginBottom: 12 },
  dateBtnText: { ...Type.footnote, color: t.text },
  card: { marginBottom: 12, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summary: { ...Type.bodyCompact, color: t.text },
  subName: { ...Type.headline, color: t.text },
  body: { ...Type.footnote, color: t.text },
  muted: { ...Type.caption1, color: t.textMuted, lineHeight: 17 },
  reminder: { marginBottom: 12, gap: 4 },
  reminderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  reminderLabel: { ...Type.footnote, fontWeight: '700', color: t.text, flex: 1 },
  reminderStatus: { ...Type.caption1, color: t.warningLabel, lineHeight: 17 },
  // UX wave B4: sends are the md Button (the 48 pt touch target), full width.
  flexBtn: { flex: 1 },
  statusLine: { ...Type.caption1, fontWeight: '700', color: t.textSecondary },
  draftInput: { ...Type.footnote, color: t.text, minHeight: 96, padding: 10, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt, textAlignVertical: 'top' },
});
