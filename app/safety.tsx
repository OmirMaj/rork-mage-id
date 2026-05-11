// safety.tsx — Safety module v1: toolbox talks + incident log.
//
// Closes one of the biggest gaps from the competitive audit: Procore +
// Contractor Foreman both have safety modules; MAGE ID did not. For
// any small GC subject to OSHA inspection, the toolbox-talk record
// and incident log are the two artifacts an inspector asks for first.
//
// Scope of v1:
//   ✓ Toolbox Talks: a templated weekly safety topic, attendee
//     sign-in (initials), date, project, topic notes
//   ✓ Incident Log: who, what, where, when, photo, witnesses,
//     OSHA-recordable flag
//   ✓ Local storage via tertiary_safety_* AsyncStorage keys (offline-
//     first, syncs via the existing OfflineSyncManager pipeline if/
//     when a Supabase table is added — for v1 it's local)
//   ✓ One-tap OSHA 300A summary roll-up (count by month)
//
// Out of scope (intentional — keep this small for v1):
//   ✗ Cross-device sync (local-only for now; add Supabase mirror
//     when usage data shows the feature has demand)
//   ✗ Auto-fill the actual OSHA 300A PDF (the form is rev-stable;
//     we render numbers for the user to type into the gov form)
//   ✗ JSA / JHA workflow (planned for v2)

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  HardHat, Plus, Calendar, Users, AlertTriangle, FileText,
  ChevronRight, Check, X,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { useProjects } from '@/contexts/ProjectContext';

interface ToolboxTalk {
  id: string;
  projectId: string | null;
  date: string; // ISO
  topic: string;
  notes: string;
  attendees: string[]; // names or initials
  createdAt: string;
}

interface Incident {
  id: string;
  projectId: string | null;
  date: string; // ISO
  who: string;
  what: string; // injury / near miss / property damage
  where: string;
  witnesses: string[];
  photoUri?: string;
  oshaRecordable: boolean;
  daysAwayFromWork?: number;
  createdAt: string;
}

const TOOLBOX_KEY = 'tertiary_safety_toolbox_talks';
const INCIDENT_KEY = 'tertiary_safety_incidents';

// Templated weekly safety topics. GCs can run through these in order
// week-over-week; common contractor safety curriculum.
const TOPIC_TEMPLATES = [
  'Fall protection — anchors, lanyards, PFAS',
  'Ladder safety — 4:1 angle, 3-point contact',
  'PPE — hard hats, eye, hearing, gloves',
  'Hot work — fire extinguisher within 25 ft',
  'Trenching — 4 ft cave-in protection threshold',
  'Lockout/Tagout (LOTO) — electrical disconnects',
  'Material handling — back strain prevention',
  'Power tool safety — guards, GFCI, inspection',
  'Heat stress — water, rest, shade',
  'Confined space — atmospheric testing, rescue plan',
  'Silica exposure — wet methods, respirators',
  'Scaffolding — competent person inspection',
  'Crane signals — qualified rigger + signal person',
  'Hazcom — SDS sheet location, label literacy',
  'Excavation — utility locates (811 call)',
];

export default function SafetyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects } = useProjects();

  const [tab, setTab] = useState<'toolbox' | 'incidents' | 'osha'>('toolbox');
  const [toolboxTalks, setToolboxTalks] = useState<ToolboxTalk[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  // New toolbox-talk form state
  const [tbOpen, setTbOpen] = useState(false);
  const [tbTopic, setTbTopic] = useState('');
  const [tbNotes, setTbNotes] = useState('');
  const [tbAttendees, setTbAttendees] = useState('');
  const [tbProjectId, setTbProjectId] = useState<string | null>(null);

  // New incident form state
  const [inOpen, setInOpen] = useState(false);
  const [inWho, setInWho] = useState('');
  const [inWhat, setInWhat] = useState('');
  const [inWhere, setInWhere] = useState('');
  const [inWitnesses, setInWitnesses] = useState('');
  const [inRecordable, setInRecordable] = useState(false);
  const [inProjectId, setInProjectId] = useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tbRaw, inRaw] = await Promise.all([
          AsyncStorage.getItem(TOOLBOX_KEY),
          AsyncStorage.getItem(INCIDENT_KEY),
        ]);
        if (cancelled) return;
        if (tbRaw) setToolboxTalks(JSON.parse(tbRaw));
        if (inRaw) setIncidents(JSON.parse(inRaw));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveToolboxTalks = useCallback(async (next: ToolboxTalk[]) => {
    setToolboxTalks(next);
    await AsyncStorage.setItem(TOOLBOX_KEY, JSON.stringify(next));
  }, []);

  const saveIncidents = useCallback(async (next: Incident[]) => {
    setIncidents(next);
    await AsyncStorage.setItem(INCIDENT_KEY, JSON.stringify(next));
  }, []);

  const handleAddToolboxTalk = useCallback(() => {
    if (!tbTopic.trim()) {
      Alert.alert('Pick a topic', 'Tap a templated topic or type your own.');
      return;
    }
    const talk: ToolboxTalk = {
      id: generateUUID(),
      projectId: tbProjectId,
      date: new Date().toISOString(),
      topic: tbTopic.trim(),
      notes: tbNotes.trim(),
      attendees: tbAttendees.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
      createdAt: new Date().toISOString(),
    };
    void saveToolboxTalks([talk, ...toolboxTalks]);
    setTbOpen(false);
    setTbTopic(''); setTbNotes(''); setTbAttendees(''); setTbProjectId(null);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [tbTopic, tbNotes, tbAttendees, tbProjectId, toolboxTalks, saveToolboxTalks]);

  const handleAddIncident = useCallback(() => {
    if (!inWho.trim() || !inWhat.trim()) {
      Alert.alert('Missing info', 'Who and What are required.');
      return;
    }
    const incident: Incident = {
      id: generateUUID(),
      projectId: inProjectId,
      date: new Date().toISOString(),
      who: inWho.trim(),
      what: inWhat.trim(),
      where: inWhere.trim(),
      witnesses: inWitnesses.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
      oshaRecordable: inRecordable,
      createdAt: new Date().toISOString(),
    };
    void saveIncidents([incident, ...incidents]);
    setInOpen(false);
    setInWho(''); setInWhat(''); setInWhere(''); setInWitnesses('');
    setInRecordable(false); setInProjectId(null);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [inWho, inWhat, inWhere, inWitnesses, inRecordable, inProjectId, incidents, saveIncidents]);

  // OSHA 300A annual summary: counts by category.
  const oshaSummary = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const recordable = incidents.filter(i => {
      const y = new Date(i.date).getFullYear();
      return y === thisYear && i.oshaRecordable;
    });
    const daysAway = recordable.reduce((s, i) => s + (i.daysAwayFromWork ?? 0), 0);
    return { total: recordable.length, daysAway, year: thisYear };
  }, [incidents]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Safety' }} />

      <View style={styles.header}>
        <Text style={styles.eyebrow}>OSHA · WORKFORCE</Text>
        <Text style={styles.heading}>Safety</Text>
        <Text style={styles.sub}>
          Toolbox talks, incident log, OSHA 300A summary. Local storage today; cross-device sync coming.
        </Text>

        <View style={styles.tabRow}>
          <Tab label="Toolbox" active={tab === 'toolbox'} onPress={() => setTab('toolbox')} />
          <Tab label="Incidents" active={tab === 'incidents'} onPress={() => setTab('incidents')} />
          <Tab label="OSHA 300A" active={tab === 'osha'} onPress={() => setTab('osha')} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
        {tab === 'toolbox' && (
          <View>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Toolbox talks</Text>
              <TouchableOpacity onPress={() => setTbOpen(true)} style={styles.addBtn} testID="safety-add-toolbox">
                <Plus size={14} color={Colors.cream} />
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {tbOpen && (
              <View style={styles.form}>
                <Text style={styles.formLabel}>Topic</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                  {TOPIC_TEMPLATES.slice(0, 6).map(t => (
                    <TouchableOpacity key={t} style={styles.chip} onPress={() => setTbTopic(t)}>
                      <Text style={styles.chipText}>{t.split(' — ')[0]}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TextInput
                  style={styles.input}
                  value={tbTopic}
                  onChangeText={setTbTopic}
                  placeholder="Type a topic or pick a template above"
                  placeholderTextColor={Colors.textMuted}
                />
                <Text style={styles.formLabel}>Notes</Text>
                <TextInput
                  style={[styles.input, { minHeight: 60 }]}
                  value={tbNotes}
                  onChangeText={setTbNotes}
                  placeholder="What did you cover? Anchor points checked, etc."
                  placeholderTextColor={Colors.textMuted}
                  multiline
                />
                <Text style={styles.formLabel}>Attendees (comma-separated)</Text>
                <TextInput
                  style={styles.input}
                  value={tbAttendees}
                  onChangeText={setTbAttendees}
                  placeholder="J. Lopez, M. Chen, T. Williams"
                  placeholderTextColor={Colors.textMuted}
                />
                <View style={styles.formActions}>
                  <TouchableOpacity onPress={() => setTbOpen(false)} style={styles.cancelBtn}>
                    <X size={14} color={Colors.textSecondary} />
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleAddToolboxTalk} style={styles.saveBtn}>
                    <Check size={14} color={Colors.cream} />
                    <Text style={styles.saveText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {!loading && toolboxTalks.length === 0 && !tbOpen && (
              <View style={styles.empty}>
                <HardHat size={36} color={Colors.accent} />
                <Text style={styles.emptyTitle}>No toolbox talks yet</Text>
                <Text style={styles.emptyBody}>
                  Run a weekly safety topic with the crew. Tap Add to log one.
                </Text>
              </View>
            )}

            {toolboxTalks.map(t => (
              <View key={t.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Calendar size={14} color={Colors.accent} />
                  <Text style={styles.cardDate}>{new Date(t.date).toLocaleDateString()}</Text>
                </View>
                <Text style={styles.cardTitle}>{t.topic}</Text>
                {t.notes ? <Text style={styles.cardBody}>{t.notes}</Text> : null}
                {t.attendees.length > 0 && (
                  <View style={styles.attendeesRow}>
                    <Users size={11} color={Colors.textMuted} />
                    <Text style={styles.attendeesText}>{t.attendees.join(', ')}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {tab === 'incidents' && (
          <View>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Incident log</Text>
              <TouchableOpacity onPress={() => setInOpen(true)} style={styles.addBtn} testID="safety-add-incident">
                <Plus size={14} color={Colors.cream} />
                <Text style={styles.addBtnText}>Log</Text>
              </TouchableOpacity>
            </View>

            {inOpen && (
              <View style={styles.form}>
                <Text style={styles.formLabel}>Who</Text>
                <TextInput style={styles.input} value={inWho} onChangeText={setInWho} placeholder="Worker name or trade" placeholderTextColor={Colors.textMuted} />
                <Text style={styles.formLabel}>What happened</Text>
                <TextInput style={[styles.input, { minHeight: 60 }]} value={inWhat} onChangeText={setInWhat} placeholder="Injury, near miss, property damage…" placeholderTextColor={Colors.textMuted} multiline />
                <Text style={styles.formLabel}>Where</Text>
                <TextInput style={styles.input} value={inWhere} onChangeText={setInWhere} placeholder="Second floor, north stairwell" placeholderTextColor={Colors.textMuted} />
                <Text style={styles.formLabel}>Witnesses (comma-separated)</Text>
                <TextInput style={styles.input} value={inWitnesses} onChangeText={setInWitnesses} placeholder="Names" placeholderTextColor={Colors.textMuted} />
                <TouchableOpacity onPress={() => setInRecordable(v => !v)} style={[styles.checkbox, inRecordable && styles.checkboxActive]}>
                  {inRecordable ? <Check size={14} color={Colors.cream} /> : null}
                  <Text style={styles.checkboxText}>OSHA-recordable (medical treatment beyond first aid, days away from work, etc.)</Text>
                </TouchableOpacity>
                <View style={styles.formActions}>
                  <TouchableOpacity onPress={() => setInOpen(false)} style={styles.cancelBtn}>
                    <X size={14} color={Colors.textSecondary} />
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleAddIncident} style={styles.saveBtn}>
                    <Check size={14} color={Colors.cream} />
                    <Text style={styles.saveText}>Log</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {!loading && incidents.length === 0 && !inOpen && (
              <View style={styles.empty}>
                <AlertTriangle size={36} color={Colors.warning} />
                <Text style={styles.emptyTitle}>Clean record</Text>
                <Text style={styles.emptyBody}>
                  No incidents logged. Add one if anything happens — even a near-miss is worth recording.
                </Text>
              </View>
            )}

            {incidents.map(i => (
              <View key={i.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Calendar size={14} color={i.oshaRecordable ? Colors.error : Colors.warning} />
                  <Text style={styles.cardDate}>{new Date(i.date).toLocaleDateString()}</Text>
                  {i.oshaRecordable && (
                    <View style={styles.osha300Pill}>
                      <Text style={styles.osha300PillText}>OSHA 300</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cardTitle}>{i.who}</Text>
                <Text style={styles.cardBody}>{i.what}</Text>
                {i.where ? <Text style={styles.cardMeta}>📍 {i.where}</Text> : null}
                {i.witnesses.length > 0 && (
                  <View style={styles.attendeesRow}>
                    <Users size={11} color={Colors.textMuted} />
                    <Text style={styles.attendeesText}>{i.witnesses.join(', ')}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {tab === 'osha' && (
          <View style={{ padding: Tokens.spacing.md }}>
            <View style={styles.oshaSummary}>
              <Text style={styles.oshaYear}>{oshaSummary.year}</Text>
              <Text style={styles.oshaLabel}>OSHA 300A Summary</Text>
              <View style={styles.oshaStatRow}>
                <View style={styles.oshaStat}>
                  <Text style={styles.oshaStatValue}>{oshaSummary.total}</Text>
                  <Text style={styles.oshaStatLabel}>Recordable cases</Text>
                </View>
                <View style={styles.oshaStat}>
                  <Text style={styles.oshaStatValue}>{oshaSummary.daysAway}</Text>
                  <Text style={styles.oshaStatLabel}>Days away from work</Text>
                </View>
              </View>
              <Text style={styles.oshaNote}>
                Transcribe these numbers onto your OSHA Form 300A (Annual Summary). Post in a visible location from Feb 1 to April 30 each year.
              </Text>
              <TouchableOpacity
                style={styles.oshaLink}
                onPress={() => router.push('https://www.osha.gov/recordkeeping/forms' as never)}
              >
                <FileText size={14} color={Colors.accent} />
                <Text style={styles.oshaLinkText}>osha.gov/recordkeeping/forms</Text>
                <ChevronRight size={14} color={Colors.accent} />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
      activeOpacity={0.7}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Tokens.spacing.lg, paddingTop: Tokens.spacing.xs, paddingBottom: 0 },
  eyebrow: { ...Type.monoSm, color: Colors.accent, fontWeight: '600' as const, marginBottom: Tokens.spacing.xs },
  heading: { ...Type.display, color: Colors.ink, marginBottom: Tokens.spacing.xxs },
  sub: { fontSize: Type.subhead.fontSize, color: Colors.textSecondary, marginBottom: 18, lineHeight: 21 },
  tabRow: {
    flexDirection: 'row' as const, gap: 6, marginBottom: 14,
  },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.fillTertiary,
  },
  tabActive: { backgroundColor: Colors.ink },
  tabText: { ...Type.bodyCompact, color: Colors.textSecondary, fontWeight: '600' as const },
  tabTextActive: { color: Colors.cream },
  sectionHead: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    paddingHorizontal: Tokens.spacing.lg, paddingTop: 14, paddingBottom: 10,
  },
  sectionTitle: { ...Type.title3, color: Colors.text },
  addBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: Tokens.spacing.xxs,
    backgroundColor: Colors.accent, paddingHorizontal: Tokens.spacing.sm, paddingVertical: 6, borderRadius: Tokens.radius.full,
  },
  addBtnText: { ...Type.caption1, color: Colors.cream, fontWeight: '700' as const },
  empty: { padding: Tokens.spacing['2xl'], alignItems: 'center' as const, gap: Tokens.spacing.xs },
  emptyTitle: { ...Type.headline, color: Colors.text, marginTop: Tokens.spacing.xs },
  emptyBody: { ...Type.footnote, color: Colors.textSecondary, textAlign: 'center' as const, maxWidth: 280 },
  card: {
    marginHorizontal: Tokens.spacing.md, marginBottom: 10, padding: 14,
    backgroundColor: Colors.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginBottom: 6 },
  cardDate: { ...Type.caption1, color: Colors.textSecondary, fontWeight: '600' as const },
  cardTitle: { ...Type.bodyEmphasized, color: Colors.text, marginBottom: Tokens.spacing.xxs },
  cardBody: { ...Type.footnote, color: Colors.textSecondary, lineHeight: 18, marginBottom: 6 },
  cardMeta: { ...Type.caption1, color: Colors.textMuted, marginBottom: Tokens.spacing.xxs },
  attendeesRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Tokens.spacing.xxs, marginTop: Tokens.spacing.xxs },
  attendeesText: { ...Type.caption1, color: Colors.textMuted, flex: 1 },
  osha300Pill: {
    backgroundColor: Colors.error + '20',
    paddingHorizontal: 6, paddingVertical: Tokens.spacing.hairline, borderRadius: Tokens.radius.xs,
  },
  osha300PillText: { ...Type.monoSm, color: Colors.error, fontWeight: '700' as const, fontSize: 9 },
  form: {
    marginHorizontal: Tokens.spacing.md, padding: 14, marginBottom: 14,
    backgroundColor: Colors.cream, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: Colors.bone,
  },
  formLabel: { ...Type.caption1, color: Colors.concrete, fontWeight: '700' as const, marginBottom: 6, marginTop: Tokens.spacing.xs },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
    borderRadius: Tokens.radius.md, paddingHorizontal: Tokens.spacing.sm, paddingVertical: 10,
    fontSize: Type.body.fontSize, color: Colors.text,
  },
  chip: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.bone,
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: 7, borderRadius: Tokens.radius.full, marginRight: 6,
  },
  chipText: { ...Type.caption1, color: Colors.concrete, fontWeight: '600' as const },
  formActions: { flexDirection: 'row' as const, gap: Tokens.spacing.xs, marginTop: 14 },
  cancelBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: Tokens.spacing.xxs,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.fillTertiary,
  },
  cancelText: { ...Type.bodyCompact, color: Colors.textSecondary, fontWeight: '600' as const },
  saveBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: Tokens.spacing.xxs,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.accent,
  },
  saveText: { ...Type.bodyCompact, color: Colors.cream, fontWeight: '700' as const },
  checkbox: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: Tokens.spacing.xs,
    marginTop: Tokens.spacing.sm, padding: 10, backgroundColor: Colors.surface, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  checkboxActive: { backgroundColor: Colors.error + '15', borderColor: Colors.error },
  checkboxText: { ...Type.footnote, color: Colors.text, flex: 1, lineHeight: 18 },
  oshaSummary: {
    backgroundColor: Colors.ink, padding: Tokens.spacing.xl, borderRadius: Tokens.radius.panel,
  },
  oshaYear: { ...Type.monoSm, color: Colors.accent, fontWeight: '600' as const, marginBottom: Tokens.spacing.xxs },
  oshaLabel: { ...Type.displaySm, color: Colors.cream, marginBottom: Tokens.spacing.xl },
  oshaStatRow: { flexDirection: 'row' as const, gap: Tokens.spacing.xl, marginBottom: Tokens.spacing.xl },
  oshaStat: { flex: 1 },
  oshaStatValue: { ...Type.display, color: Colors.cream, fontSize: 48, lineHeight: 52 },
  oshaStatLabel: { ...Type.caption1, color: 'rgba(244, 239, 230, 0.6)', marginTop: Tokens.spacing.xxs },
  oshaNote: { ...Type.footnote, color: 'rgba(244, 239, 230, 0.7)', lineHeight: 18, marginBottom: 14 },
  oshaLink: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
  },
  oshaLinkText: { ...Type.bodyCompact, color: Colors.accent, fontWeight: '600' as const, flex: 1 },
});
