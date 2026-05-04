// OAC Meeting — Owner-Architect-Contractor weekly meeting tool.
//
// One screen, two modes:
//   - List mode: shows past meetings + "New meeting" button (default
//     when navigating from project-detail).
//   - Detail mode: opens when user taps a meeting OR creates a new one.
//     Renders agenda (auto-built from project state), voice-capture,
//     AI-generated minutes, and a Distribute action that emails the
//     minutes to attendees.
//
// Mode is internal state, not separate routes — keeps the navigation
// surface flat. The visible affordance is a toolbar back button when
// in detail mode.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Plus, Sparkles, RefreshCw, Send, CheckCircle2, Circle,
  Mic, X, Users, Calendar, AlertTriangle, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import VoiceRecorder from '@/components/VoiceRecorder';
import { sendEmail } from '@/utils/emailService';
import { FeatureHeader } from '@/components/FeatureHeader';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { generateUUID } from '@/utils/generateId';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  buildAgendaFromProjectState, mergeAgenda, generateMinutesFromTranscript,
} from '@/utils/oacEngine';
import type {
  OACMeeting, OACAgendaItem, OACAgendaSection, OACAttendee, OACActionItem,
} from '@/types';

const SECTION_LABELS: Record<OACAgendaSection, string> = {
  safety:          'Safety',
  schedule:        'Schedule',
  rfis:            'RFIs',
  submittals:      'Submittals',
  change_orders:   'Change Orders',
  budget:          'Budget',
  decisions:       'Decisions Needed',
  action_items:    'Action Items',
  open_discussion: 'Open Discussion',
  next_meeting:    'Next Meeting',
};

const STATUS_COLOR = {
  info: Colors.textSecondary,
  warn: Colors.warning,
  urgent: Colors.error,
  done: Colors.success,
} as const;

export default function OACMeetingScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('rfis_submittals')) {
    return (
      <Paywall
        visible={true}
        feature="OAC Meetings"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <OACMeetingInner />;
}

function OACMeetingInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const ctx = useProjects() as any;
  const project = ctx.getProject?.(projectId ?? '');
  const meetings: OACMeeting[] = useMemo(() => {
    return (ctx.getOACMeetingsForProject?.(projectId ?? '') ?? []) as OACMeeting[];
  }, [ctx, projectId]);

  // Mode + active meeting state
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo<OACMeeting | null>(() => {
    if (!activeId) return null;
    return meetings.find(m => m.id === activeId) ?? null;
  }, [activeId, meetings]);

  // Loading state for AI agenda regeneration + minutes
  const [generatingAgenda, setGeneratingAgenda] = useState(false);
  const [generatingMinutes, setGeneratingMinutes] = useState(false);
  const [distributing, setDistributing] = useState(false);

  // ─── Build a fresh meeting ──────────────────────────────────────
  const handleNewMeeting = useCallback(() => {
    if (!project) return;
    setGeneratingAgenda(true);
    try {
      const rfis = ctx.getRFIsForProject?.(project.id) ?? [];
      const submittals = ctx.getSubmittalsForProject?.(project.id) ?? [];
      const changeOrders = ctx.getChangeOrdersForProject?.(project.id) ?? [];
      const dailyReports = ctx.getDailyReportsForProject?.(project.id) ?? [];
      const tasks = project.schedule?.tasks ?? [];
      const agenda = buildAgendaFromProjectState({
        project, rfis, submittals, changeOrders, dailyReports,
        schedule: project.schedule, tasks,
      });
      const meeting: OACMeeting = {
        id: generateUUID(),
        projectId: project.id,
        number: meetings.length + 1,
        scheduledAt: new Date().toISOString(),
        durationMinutes: 60,
        attendees: defaultAttendeesFromProject(project),
        agenda,
        actionItems: [],
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      ctx.addOACMeeting?.(meeting);
      setActiveId(meeting.id);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[OAC] New meeting failed:', err);
      Alert.alert('Could not create meeting', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setGeneratingAgenda(false);
    }
  }, [project, meetings.length, ctx]);

  const handleRefreshAgenda = useCallback(() => {
    if (!project || !active) return;
    setGeneratingAgenda(true);
    try {
      const rfis = ctx.getRFIsForProject?.(project.id) ?? [];
      const submittals = ctx.getSubmittalsForProject?.(project.id) ?? [];
      const changeOrders = ctx.getChangeOrdersForProject?.(project.id) ?? [];
      const dailyReports = ctx.getDailyReportsForProject?.(project.id) ?? [];
      const tasks = project.schedule?.tasks ?? [];
      const fresh = buildAgendaFromProjectState({
        project, rfis, submittals, changeOrders, dailyReports,
        schedule: project.schedule, tasks,
      });
      const merged = mergeAgenda(active.agenda, fresh);
      ctx.updateOACMeeting?.(active.id, { agenda: merged, updatedAt: new Date().toISOString() });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setGeneratingAgenda(false);
    }
  }, [project, active, ctx]);

  const handleToggleCovered = useCallback((itemId: string) => {
    if (!active) return;
    const updatedAgenda = active.agenda.map(a =>
      a.id === itemId ? { ...a, covered: !a.covered } : a
    );
    ctx.updateOACMeeting?.(active.id, { agenda: updatedAgenda, updatedAt: new Date().toISOString() });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [active, ctx]);

  const handleNoteChange = useCallback((itemId: string, note: string) => {
    if (!active) return;
    const updatedAgenda = active.agenda.map(a =>
      a.id === itemId ? { ...a, manualNote: note } : a
    );
    ctx.updateOACMeeting?.(active.id, { agenda: updatedAgenda, updatedAt: new Date().toISOString() });
  }, [active, ctx]);

  // ─── Voice → minutes ───────────────────────────────────────────
  const handleTranscript = useCallback((newTranscript: string) => {
    if (!active) return;
    // Append to existing transcript so multiple recording sessions during
    // the meeting accumulate.
    const combined = active.transcript
      ? `${active.transcript}\n\n${newTranscript}`
      : newTranscript;
    ctx.updateOACMeeting?.(active.id, { transcript: combined, updatedAt: new Date().toISOString() });
  }, [active, ctx]);

  const handleGenerateMinutes = useCallback(async () => {
    if (!active || !project) return;
    if (!active.transcript || active.transcript.trim().length < 50) {
      Alert.alert(
        'Need a transcript first',
        'Tap the mic to capture the meeting discussion before generating minutes. Even a 60-second summary at the end works.',
      );
      return;
    }
    setGeneratingMinutes(true);
    try {
      const result = await generateMinutesFromTranscript({
        projectName: project.name,
        meetingNumber: active.number,
        meetingDate: new Date(active.scheduledAt).toLocaleDateString(),
        attendees: active.attendees.map(a => `${a.name}${a.role ? ` (${a.role})` : ''}`),
        agendaTitles: active.agenda.map(a => a.title),
        transcript: active.transcript,
      });
      // Merge AI's extracted action items into the meeting's action list.
      const newActions: OACActionItem[] = result.actionItems
        .filter(a => a.description && a.ballInCourt)
        .map(a => ({
          id: generateUUID(),
          description: a.description,
          ballInCourt: a.ballInCourt,
          dueBy: a.dueBy,
          status: 'open' as const,
          createdAt: new Date().toISOString(),
          meetingId: active.id,
        }));
      ctx.updateOACMeeting?.(active.id, {
        minutes: result.body,
        actionItems: [...active.actionItems, ...newActions],
        status: 'concluded',
        updatedAt: new Date().toISOString(),
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[OAC] Generate minutes failed:', err);
      Alert.alert('Could not generate minutes', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setGeneratingMinutes(false);
    }
  }, [active, project, ctx]);

  const handleDistribute = useCallback(async () => {
    if (!active || !project) return;
    if (!active.minutes || active.minutes.trim().length < 20) {
      Alert.alert('No minutes yet', 'Generate or paste minutes before distributing.');
      return;
    }
    const recipients = active.attendees.filter(a => a.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email));
    if (recipients.length === 0) {
      Alert.alert('No emails', 'Add email addresses to the attendees so they receive the minutes.');
      return;
    }
    setDistributing(true);
    try {
      const subject = `OAC Meeting #${active.number} Minutes — ${project.name}`;
      const html = buildMinutesEmailHtml({
        projectName: project.name,
        meetingNumber: active.number,
        meetingDate: new Date(active.scheduledAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        minutesMarkdown: active.minutes,
        attendees: active.attendees,
        actionItems: active.actionItems,
      });
      const log: OACMeeting['distributionLog'] = [];
      for (const r of recipients) {
        const result = await sendEmail({ to: r.email!, subject, html });
        log.push({ recipient: r.email!, sentAt: new Date().toISOString(), ok: result.success, error: result.error });
      }
      ctx.updateOACMeeting?.(active.id, {
        status: 'distributed',
        distributedAt: new Date().toISOString(),
        distributionLog: log,
        updatedAt: new Date().toISOString(),
      });
      const okCount = log.filter(l => l.ok).length;
      Alert.alert('Minutes distributed', `Sent to ${okCount} of ${recipients.length} attendees.`);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[OAC] Distribute failed:', err);
      Alert.alert('Distribution failed', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setDistributing(false);
    }
  }, [active, project, ctx]);

  if (!project) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'OAC Meetings' }} />
        <Text style={styles.notFound}>Project not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Detail mode
  if (active) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => setActiveId(null)} hitSlop={10} style={styles.headerBack}>
            <ChevronLeft size={22} color={Colors.primary} />
            <Text style={styles.headerBackText}>All meetings</Text>
          </TouchableOpacity>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{labelForStatus(active.status)}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}>
          {/* Title row */}
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>OAC Meeting #{active.number}</Text>
            <Text style={styles.title}>{project.name}</Text>
            <Text style={styles.subtitle}>
              {new Date(active.scheduledAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
          </View>

          {/* Attendees */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Users size={16} color={Colors.primary} />
              <Text style={styles.cardLabel}>Attendees ({active.attendees.length})</Text>
            </View>
            {active.attendees.length === 0 ? (
              <Text style={styles.emptyHint}>No attendees yet. Add the owner, architect, engineer, etc.</Text>
            ) : (
              active.attendees.map(a => (
                <View key={a.id} style={styles.attendeeRow}>
                  <Text style={styles.attendeeName}>{a.name}</Text>
                  <Text style={styles.attendeeMeta}>
                    {(a.role ?? 'other').replace('_', ' ')}{a.email ? ` · ${a.email}` : ''}
                  </Text>
                </View>
              ))
            )}
            <TouchableOpacity
              style={styles.smallBtn}
              onPress={() => promptAddAttendee(active, ctx)}
              testID="oac-add-attendee"
            >
              <Plus size={14} color={Colors.primary} />
              <Text style={styles.smallBtnText}>Add attendee</Text>
            </TouchableOpacity>
          </View>

          {/* Agenda */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Sparkles size={16} color={Colors.primary} />
              <Text style={styles.cardLabel}>Agenda · auto-built from project state</Text>
              <TouchableOpacity onPress={handleRefreshAgenda} disabled={generatingAgenda} hitSlop={10}>
                {generatingAgenda
                  ? <ActivityIndicator size="small" color={Colors.primary} />
                  : <RefreshCw size={15} color={Colors.primary} />}
              </TouchableOpacity>
            </View>
            <Text style={styles.cardHelper}>Tap each item to mark covered. Add a manual note below any item.</Text>
            {Object.keys(SECTION_LABELS).map(sec => {
              const sectionItems = active.agenda.filter(a => a.section === sec);
              if (sectionItems.length === 0) return null;
              return (
                <View key={sec} style={styles.section}>
                  <Text style={styles.sectionLabel}>{SECTION_LABELS[sec as OACAgendaSection]}</Text>
                  {sectionItems.map(item => (
                    <View key={item.id} style={styles.agendaItem}>
                      <TouchableOpacity onPress={() => handleToggleCovered(item.id)} style={styles.agendaCheck} hitSlop={6}>
                        {item.covered
                          ? <CheckCircle2 size={20} color={Colors.success} />
                          : <Circle size={20} color={Colors.textMuted} />}
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.agendaTitle, item.covered && styles.agendaTitleDone]}>
                          {item.title}
                        </Text>
                        {item.detail ? (
                          <Text style={styles.agendaDetail}>{item.detail}</Text>
                        ) : null}
                        <TextInput
                          style={styles.agendaNote}
                          value={item.manualNote ?? ''}
                          onChangeText={t => handleNoteChange(item.id, t)}
                          placeholder="Add a note..."
                          placeholderTextColor={Colors.textMuted}
                          multiline
                        />
                      </View>
                      {item.status && item.status !== 'info' ? (
                        <View style={[styles.itemPill, { backgroundColor: STATUS_COLOR[item.status] + '20' }]}>
                          <Text style={[styles.itemPillText, { color: STATUS_COLOR[item.status] }]}>
                            {item.status === 'urgent' ? '!' : item.status === 'warn' ? '⚠' : item.status === 'done' ? '✓' : ''}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              );
            })}
            <Text style={styles.coveredSummary}>
              {active.agenda.filter(a => a.covered).length} of {active.agenda.length} covered
            </Text>
          </View>

          {/* Voice capture */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Mic size={16} color={Colors.primary} />
              <Text style={styles.cardLabel}>Voice capture</Text>
            </View>
            <Text style={styles.cardHelper}>
              Record the meeting (or just the wrap-up summary). The AI uses the transcript to draft minutes.
            </Text>
            <VoiceRecorder
              onTranscriptReady={handleTranscript}
              title="Capture meeting discussion"
              contextLine={`OAC #${active.number} — ${project.name}`}
              suggestions={[
                "Architect, what's the response on RFI 14",
                "Owner approved CO 4 for the kitchen pendant rerun, $3,200",
                "Drywall sub will finish the master suite by Friday",
                "We need a decision on the master bath tile by next week",
              ]}
            />
            {active.transcript ? (
              <View style={styles.transcriptCard}>
                <Text style={styles.transcriptLabel}>Captured ({active.transcript.length} chars)</Text>
                <Text style={styles.transcriptText} numberOfLines={6}>{active.transcript}</Text>
              </View>
            ) : null}
          </View>

          {/* Minutes */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Sparkles size={16} color={Colors.primary} />
              <Text style={styles.cardLabel}>Minutes</Text>
            </View>
            {active.minutes ? (
              <>
                <TextInput
                  style={styles.minutesInput}
                  value={active.minutes}
                  onChangeText={t => ctx.updateOACMeeting?.(active.id, { minutes: t, updatedAt: new Date().toISOString() })}
                  multiline
                  textAlignVertical="top"
                  placeholderTextColor={Colors.textMuted}
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, distributing && styles.primaryBtnDisabled]}
                  onPress={handleDistribute}
                  disabled={distributing}
                  testID="oac-distribute"
                >
                  {distributing
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <><Send size={16} color="#fff" /><Text style={styles.primaryBtnText}>Distribute to attendees</Text></>}
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtn, generatingMinutes && styles.primaryBtnDisabled]}
                onPress={handleGenerateMinutes}
                disabled={generatingMinutes}
                testID="oac-generate-minutes"
              >
                {generatingMinutes
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <><Sparkles size={16} color="#fff" /><Text style={styles.primaryBtnText}>Generate minutes from transcript</Text></>}
              </TouchableOpacity>
            )}
          </View>

          {/* Action items */}
          {active.actionItems.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <CheckCircle2 size={16} color={Colors.primary} />
                <Text style={styles.cardLabel}>Action items ({active.actionItems.length})</Text>
              </View>
              {active.actionItems.map(a => (
                <View key={a.id} style={styles.actionRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.actionDesc}>{a.description}</Text>
                    <Text style={styles.actionMeta}>
                      Owner: {a.ballInCourt}{a.dueBy ? ` · Due ${new Date(a.dueBy).toLocaleDateString()}` : ''}
                    </Text>
                  </View>
                  <View style={[styles.actionStatus, a.status === 'done' && styles.actionStatusDone]}>
                    <Text style={[styles.actionStatusText, a.status === 'done' && styles.actionStatusTextDone]}>
                      {a.status.replace('_', ' ')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // List mode
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Project Meetings' }} />
      <FeatureHeader
        eyebrow="OAC Weekly"
        title="Weekly project meeting"
        subtitle="The standing call with the owner, architect, and you. We auto-build the agenda from open RFIs, change orders, and schedule slips — and record + transcribe the meeting."
        explainer={{
          term: 'OAC Meeting',
          definition: '"OAC" stands for Owner / Architect / Contractor — the three parties who meet weekly (or biweekly) on most jobs to align on progress, decisions, and changes. This is the meeting where blocking RFIs get resolved, change orders get approved, and the schedule gets re-baselined.',
          whenToUse: [
            'You\'re running a project with regular owner/architect involvement',
            'You want one place to track decisions across weeks',
            'You need a paper trail of who agreed to what, when',
          ],
        }}
      />
      <View style={styles.listHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.subtitle}>{project.name} · {meetings.length} meeting{meetings.length === 1 ? '' : 's'} on file</Text>
        </View>
        <TouchableOpacity
          style={[styles.newMeetingBtn, generatingAgenda && styles.primaryBtnDisabled]}
          onPress={handleNewMeeting}
          disabled={generatingAgenda}
          testID="oac-new-meeting"
        >
          {generatingAgenda
            ? <ActivityIndicator size="small" color="#fff" />
            : <><Plus size={16} color="#fff" /><Text style={styles.primaryBtnText}>New meeting</Text></>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30 }}>
        {meetings.length === 0 ? (
          <View style={styles.emptyState}>
            <Calendar size={36} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No OAC meetings yet</Text>
            <Text style={styles.emptyBody}>
              The OAC weekly is the central meeting where owner, architect, and contractor sync. Tap "New meeting" — MAGE ID auto-builds the agenda from open RFIs, submittals, change orders, and schedule slips.
            </Text>
          </View>
        ) : (
          meetings
            .slice()
            .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
            .map(m => (
              <TouchableOpacity
                key={m.id}
                style={styles.meetingRow}
                onPress={() => setActiveId(m.id)}
                activeOpacity={0.7}
                testID={`oac-meeting-${m.id}`}
              >
                <View style={[styles.meetingBadge, m.status === 'distributed' && { backgroundColor: Colors.success + '20' }]}>
                  <Text style={[styles.meetingBadgeText, m.status === 'distributed' && { color: Colors.success }]}>
                    #{m.number}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.meetingTitle}>
                    {new Date(m.scheduledAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                  <Text style={styles.meetingMeta}>
                    {m.attendees.length} attendees · {m.agenda.filter(a => a.covered).length}/{m.agenda.length} covered · {labelForStatus(m.status)}
                  </Text>
                </View>
                {m.status === 'distributed'
                  ? <CheckCircle2 size={18} color={Colors.success} />
                  : m.status === 'concluded'
                    ? <Clock size={18} color={Colors.warning} />
                    : <Circle size={18} color={Colors.textMuted} />}
              </TouchableOpacity>
            ))
        )}
      </ScrollView>
    </View>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function labelForStatus(s: OACMeeting['status']): string {
  switch (s) {
    case 'draft':        return 'Draft';
    case 'scheduled':    return 'Scheduled';
    case 'in_progress':  return 'In progress';
    case 'concluded':    return 'Concluded — ready to distribute';
    case 'distributed':  return 'Distributed';
  }
}

function defaultAttendeesFromProject(project: any): OACAttendee[] {
  // Pull whatever stakeholders the project has on file. The GC can edit.
  const out: OACAttendee[] = [];
  // Owner from the homeowner portal invites
  const inv = project.clientPortal?.invites?.[0];
  if (inv) out.push({ id: generateUUID(), name: inv.name ?? 'Owner', email: inv.email, role: 'owner' });
  // GC from contract / settings — we keep this generic since settings live elsewhere
  return out;
}

function promptAddAttendee(meeting: OACMeeting, ctx: any) {
  Alert.prompt?.(
    'Add attendee',
    'Name (then we\'ll ask for email)',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Next',
        onPress: (name?: string) => {
          if (!name?.trim()) return;
          Alert.prompt?.(
            'Email (optional)',
            'For sending minutes',
            [
              { text: 'Skip',
                onPress: () => addAttendee(meeting, ctx, { id: generateUUID(), name: name.trim(), role: 'other' }),
              },
              { text: 'Add',
                onPress: (email?: string) => addAttendee(meeting, ctx, {
                  id: generateUUID(), name: name.trim(),
                  email: email?.trim() || undefined,
                  role: 'other',
                }),
              },
            ],
            'plain-text',
            '',
            'email-address',
          );
        },
      },
    ],
    'plain-text',
  );
}

function addAttendee(meeting: OACMeeting, ctx: any, attendee: OACAttendee) {
  ctx.updateOACMeeting?.(meeting.id, {
    attendees: [...meeting.attendees, attendee],
    updatedAt: new Date().toISOString(),
  });
}

function buildMinutesEmailHtml(opts: {
  projectName: string;
  meetingNumber: number;
  meetingDate: string;
  minutesMarkdown: string;
  attendees: OACAttendee[];
  actionItems: OACActionItem[];
}): string {
  const { projectName, meetingNumber, meetingDate, minutesMarkdown, attendees, actionItems } = opts;
  // Naive markdown → HTML for ## and -
  const html = minutesMarkdown
    .replace(/^## (.+)$/gm, '<h3 style="margin:18px 0 8px;color:#0B0D10">$1</h3>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul style="padding-left:20px;margin:8px 0">$1</ul>')
    .replace(/\n\n/g, '<br/><br/>');

  const openActions = actionItems.filter(a => a.status !== 'done');
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;padding:24px;color:#111">
    <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06)">
      <div style="background:#0B0D10;color:#FF6A1A;padding:24px 28px">
        <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase">OAC Meeting Minutes</div>
        <div style="font-size:20px;font-weight:800;color:#fff;margin-top:4px">${projectName}</div>
        <div style="font-size:13px;color:#a5a5b8;margin-top:6px">Meeting #${meetingNumber} · ${meetingDate}</div>
      </div>
      <div style="padding:24px 28px;font-size:14px;line-height:1.6">
        ${html}
        ${openActions.length > 0 ? `
          <h3 style="margin-top:24px;border-top:1px solid #e5e5e5;padding-top:18px">Open action items</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="background:#f9f9f9">
              <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #ddd">Action</th>
              <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #ddd">Owner</th>
              <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #ddd">Due</th>
            </tr>
            ${openActions.map(a => `<tr>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0">${a.description}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0">${a.ballInCourt}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0">${a.dueBy ? new Date(a.dueBy).toLocaleDateString() : '—'}</td>
            </tr>`).join('')}
          </table>
        ` : ''}
        <p style="margin-top:24px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px">
          Distributed via MAGE ID. Reply to this email with corrections — they go to the GC.
        </p>
      </div>
    </div>
  </body></html>`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFound: { fontSize: Type.callout.fontSize, color: Colors.text, fontWeight: '600' as const, marginBottom: 12 },
  backBtn: { paddingHorizontal: 18, paddingVertical: 10, backgroundColor: Colors.primary, borderRadius: Tokens.radius.md },
  backBtnText: { color: '#fff', fontWeight: '700' as const },

  // List mode
  listHeader: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  eyebrow: {
    fontSize: 10, fontWeight: '800' as const, color: Colors.textMuted,
    letterSpacing: 0.7, textTransform: 'uppercase' as const,
  },
  title: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: Colors.text, marginTop: 2, letterSpacing: -0.4 },
  subtitle: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: 2 },
  newMeetingBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 14, paddingVertical: 11,
    backgroundColor: Colors.primary, borderRadius: Tokens.radius.card,
  },
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: Colors.text },
  emptyBody: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19, paddingHorizontal: 32 },
  meetingRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.card, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.cardBorder,
    gap: 12,
  },
  meetingBadge: {
    width: 44, height: 44, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  meetingBadgeText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: Colors.primary },
  meetingTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text },
  meetingMeta: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: 2 },

  // Detail mode
  detailHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  headerBack: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  headerBackText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: Colors.primary },
  statusPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary + '15',
  },
  statusPillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: Colors.primary, letterSpacing: 0.4 },
  titleBlock: { marginBottom: 16 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 8 },
  cardLabel: { flex: 1, fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  cardHelper: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, lineHeight: 16, marginBottom: 8 },
  emptyHint: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, fontStyle: 'italic' as const },
  smallBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '30',
    alignSelf: 'flex-start' as const,
    marginTop: 8,
  },
  smallBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const, color: Colors.primary },

  attendeeRow: { paddingVertical: 6 },
  attendeeName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text },
  attendeeMeta: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: 2 },

  section: { marginTop: 6, marginBottom: 4 },
  sectionLabel: {
    fontSize: 10, fontWeight: '800' as const, color: Colors.primary,
    letterSpacing: 0.7, textTransform: 'uppercase' as const,
    marginTop: 8, marginBottom: 4,
  },
  agendaItem: {
    flexDirection: 'row' as const,
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  agendaCheck: { paddingTop: 2 },
  agendaTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text, lineHeight: 19 },
  agendaTitleDone: { color: Colors.textMuted, textDecorationLine: 'line-through' as const },
  agendaDetail: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, marginTop: 3, lineHeight: 16 },
  agendaNote: {
    fontSize: Type.caption1.fontSize, color: Colors.text,
    backgroundColor: Colors.background,
    borderRadius: Tokens.radius.xs, padding: 6, marginTop: 6,
    minHeight: 28,
  },
  itemPill: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  itemPillText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const },
  coveredSummary: {
    fontSize: Type.caption2.fontSize, color: Colors.textMuted, fontStyle: 'italic' as const,
    textAlign: 'right' as const, marginTop: 6,
  },

  transcriptCard: {
    backgroundColor: Colors.background,
    borderRadius: Tokens.radius.sm, padding: 10,
    marginTop: 8,
  },
  transcriptLabel: { fontSize: 10, fontWeight: '800' as const, color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' as const, marginBottom: 4 },
  transcriptText: { fontSize: Type.caption1.fontSize, color: Colors.text, lineHeight: 16 },

  minutesInput: {
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: Tokens.radius.md, padding: 12,
    fontSize: Type.footnote.fontSize, color: Colors.text,
    minHeight: 200,
    marginBottom: 12,
  },

  primaryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.card, paddingVertical: 14,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: '#fff' },

  actionRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
    gap: 10,
  },
  actionDesc: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.text },
  actionMeta: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 2 },
  actionStatus: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.warning + '15',
  },
  actionStatusDone: { backgroundColor: Colors.success + '15' },
  actionStatusText: { fontSize: 10, fontWeight: '700' as const, color: Colors.warning, letterSpacing: 0.3, textTransform: 'uppercase' as const },
  actionStatusTextDone: { color: Colors.success },
});
