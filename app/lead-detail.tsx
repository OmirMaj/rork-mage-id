// Lead detail — working screen for a single lead.
//
// Where Buildertrend gives you a form-with-tabs that scrolls forever,
// this is a single column with the moves a GC actually makes:
//   - Tap-to-call / tap-to-text / tap-to-email at the top.
//   - Stage chips with one-tap progression and a "Convert to project"
//     button that fires when the lead reaches 'won'.
//   - Activity log: every call/text/email/note logged in one timeline,
//     dictatable by voice (logTouch).
//   - AI score badge with the reason inline.
//   - Inline voice fill for the whole record (re-dictate to update).

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Linking, Platform, Alert, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Phone, Mail, MapPin, ChevronRight, MessageSquare, Calendar, Clock,
  Trash2, Save, Sparkles, ArrowRight, Briefcase, Mic, X,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  LEAD_STAGES, LEAD_STAGE_LABELS, LEAD_SOURCES, LEAD_SOURCE_LABELS,
  type Lead, type LeadStage, type LeadSource, type LeadTouchKind,
} from '@/types';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import VoiceCaptureModal from '@/components/VoiceCaptureModal';
import { parseLeadFromTranscript, pickIfEmpty, titleCase } from '@/utils/voiceFormParsers';

export default function LeadDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { leadId, mode } = useLocalSearchParams<{ leadId?: string; mode?: string }>();
  const { getLead, addLead, updateLead, deleteLead, addLeadTouch, convertLeadToProject } = useProjects();

  const isNew = mode === 'new' || !leadId;
  const existing = !isNew && leadId ? getLead(leadId) : null;

  const [name, setName] = useState(existing?.name ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [projectType, setProjectType] = useState(existing?.projectType ?? '');
  const [scope, setScope] = useState(existing?.scope ?? '');
  const [budgetMin, setBudgetMin] = useState<string>(existing?.budgetMin ? String(existing.budgetMin) : '');
  const [budgetMax, setBudgetMax] = useState<string>(existing?.budgetMax ? String(existing.budgetMax) : '');
  const [timeline, setTimeline] = useState(existing?.timeline ?? '');
  const [source, setSource] = useState<LeadSource>(existing?.source ?? 'other');
  const [stage, setStage] = useState<LeadStage>(existing?.stage ?? 'new');
  const [score, setScore] = useState<number | undefined>(existing?.score);
  const [scoreReason, setScoreReason] = useState<string>(existing?.scoreReason ?? '');

  // Activity log inputs.
  const [touchKind, setTouchKind] = useState<LeadTouchKind>('call');
  const [touchBody, setTouchBody] = useState('');
  const [voiceLogOpen, setVoiceLogOpen] = useState(false);

  const canSave = name.trim().length > 0;

  const saveAndExit = useCallback(() => {
    if (!canSave) {
      Alert.alert('Missing name', 'Add a name for this lead.');
      return;
    }
    const payload = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      projectType: projectType.trim() || undefined,
      scope: scope.trim() || undefined,
      budgetMin: budgetMin ? Number(budgetMin) : undefined,
      budgetMax: budgetMax ? Number(budgetMax) : undefined,
      timeline: timeline.trim() || undefined,
      source,
      stage,
      score,
      scoreReason: scoreReason || undefined,
    };
    if (isNew) {
      addLead({ ...payload, touches: [] });
    } else if (existing) {
      updateLead(existing.id, payload);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }, [canSave, name, phone, email, address, projectType, scope, budgetMin, budgetMax, timeline, source, stage, score, scoreReason, isNew, existing, addLead, updateLead, router]);

  const handleConvert = useCallback(() => {
    if (!existing) return;
    Alert.alert(
      'Convert to project?',
      `This will mark "${existing.name}" as Won and create a new project carrying over the contact info, scope, and budget.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Convert',
          onPress: () => {
            const projectId = convertLeadToProject(existing.id);
            if (projectId) {
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.replace({ pathname: '/project-detail' as never, params: { id: projectId } as never });
            }
          },
        },
      ],
    );
  }, [existing, convertLeadToProject, router]);

  const handleDelete = useCallback(() => {
    if (!existing) return;
    Alert.alert(
      'Delete this lead?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            deleteLead(existing.id);
            router.back();
          },
        },
      ],
    );
  }, [existing, deleteLead, router]);

  const handleLogTouch = useCallback(() => {
    if (!existing || !touchBody.trim()) return;
    addLeadTouch(existing.id, touchKind, touchBody.trim());
    setTouchBody('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [existing, touchKind, touchBody, addLeadTouch]);

  const handleVoiceLogTouch = useCallback(async (transcript: string) => {
    if (!existing) return;
    addLeadTouch(existing.id, touchKind, transcript);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [existing, touchKind, addLeadTouch]);

  return (
    <>
      <Stack.Screen options={{ title: isNew ? 'New lead' : existing?.name ?? 'Lead', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} keyboardShouldPersistTaps="handled">
          {/* Quick actions row */}
          {existing && (
            <View style={styles.quickRow}>
              {!!existing.phone && (
                <>
                  <TouchableOpacity style={styles.quickBtn} activeOpacity={0.85}
                    onPress={() => Linking.openURL(`tel:${existing.phone}`)}>
                    <Phone size={16} color={Colors.text} />
                    <Text style={styles.quickBtnText}>Call</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.quickBtn} activeOpacity={0.85}
                    onPress={() => Linking.openURL(`sms:${existing.phone}`)}>
                    <MessageSquare size={16} color={Colors.text} />
                    <Text style={styles.quickBtnText}>Text</Text>
                  </TouchableOpacity>
                </>
              )}
              {!!existing.email && (
                <TouchableOpacity style={styles.quickBtn} activeOpacity={0.85}
                  onPress={() => Linking.openURL(`mailto:${existing.email}`)}>
                  <Mail size={16} color={Colors.text} />
                  <Text style={styles.quickBtnText}>Email</Text>
                </TouchableOpacity>
              )}
              {!!existing.address && (
                <TouchableOpacity style={styles.quickBtn} activeOpacity={0.85}
                  onPress={() => Linking.openURL(`maps:?q=${encodeURIComponent(existing.address!)}`)}>
                  <MapPin size={16} color={Colors.text} />
                  <Text style={styles.quickBtnText}>Map</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Score badge */}
          {score != null && (
            <View style={styles.scoreCard}>
              <View style={[styles.scoreCircle, score >= 8 && styles.scoreCircleHot]}>
                <Sparkles size={14} color={score >= 8 ? '#FFF' : Colors.primary} />
                <Text style={[styles.scoreCircleText, score >= 8 && styles.scoreCircleTextHot]}>{score}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.scoreCardTitle}>Fit score</Text>
                <Text style={styles.scoreCardReason} numberOfLines={3}>{scoreReason || '—'}</Text>
              </View>
            </View>
          )}

          {/* Stage chips */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Stage</Text>
            <View style={styles.chipRow}>
              {LEAD_STAGES.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, stage === s && styles.chipActive]}
                  onPress={() => {
                    setStage(s);
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                >
                  <Text style={[styles.chipText, stage === s && styles.chipTextActive]}>{LEAD_STAGE_LABELS[s]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {existing && stage === 'won' && !existing.convertedProjectId && (
              <TouchableOpacity style={styles.convertBtn} onPress={handleConvert} activeOpacity={0.85}>
                <Briefcase size={16} color="#FFF" />
                <Text style={styles.convertBtnText}>Convert to project</Text>
                <ArrowRight size={16} color="#FFF" />
              </TouchableOpacity>
            )}
            {existing?.convertedProjectId && (
              <TouchableOpacity
                style={styles.convertedBtn}
                onPress={() => router.replace({ pathname: '/project-detail' as never, params: { id: existing.convertedProjectId } as never })}
                activeOpacity={0.85}
              >
                <Briefcase size={16} color={Colors.primary} />
                <Text style={styles.convertedBtnText}>Open the project</Text>
                <ChevronRight size={16} color={Colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Voice fill */}
          <View style={styles.section}>
            <InlineVoiceFill
              title={isNew ? 'Capture this lead' : 'Update this lead'}
              contextLine={isNew ? 'Speak the way the homeowner described it' : `for ${existing?.name}`}
              buttonLabel={isNew ? 'Fill lead by voice' : 'Add detail by voice'}
              suggestions={[
                'John Smith, 555 1234, kitchen remodel, found us on Houzz, eighty thousand budget, spring',
                'Jane Garcia, jane@email.com, full bathroom renovation, referral from Bob, twenty-five thousand',
                'Henderson family, 312 555 0199, two-story addition, our website, two hundred thousand',
                'Mike Doe, walk-in this morning, ADU in the back yard, one fifty',
              ]}
              onTranscript={async (transcript) => {
                const partial = await parseLeadFromTranscript(transcript);
                if (partial.name) setName(prev => pickIfEmpty(prev, titleCase(partial.name)));
                if (partial.phone) setPhone(prev => pickIfEmpty(prev, partial.phone));
                if (partial.email) setEmail(prev => pickIfEmpty(prev, partial.email));
                if (partial.address) setAddress(prev => pickIfEmpty(prev, partial.address));
                if (partial.projectType) setProjectType(prev => pickIfEmpty(prev, partial.projectType));
                if (partial.scope) setScope(prev => pickIfEmpty(prev, partial.scope));
                if (partial.budgetMin > 0) setBudgetMin(prev => prev || String(partial.budgetMin));
                if (partial.budgetMax > 0) setBudgetMax(prev => prev || String(partial.budgetMax));
                if (partial.timeline) setTimeline(prev => pickIfEmpty(prev, partial.timeline));
                if (partial.source && partial.source !== 'other') setSource(partial.source);
                // Score: always update — that's the AI's job.
                if (partial.score && partial.score > 0) setScore(partial.score);
                if (partial.scoreReason) setScoreReason(partial.scoreReason);
              }}
            />
          </View>

          {/* Fields */}
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>Name *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Homeowner name" placeholderTextColor={Colors.textMuted} />

            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="(555) 555-1234" placeholderTextColor={Colors.textMuted} keyboardType="phone-pad" />

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="name@email.com" placeholderTextColor={Colors.textMuted} keyboardType="email-address" autoCapitalize="none" />

            <Text style={styles.fieldLabel}>Address</Text>
            <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="123 Main St, City" placeholderTextColor={Colors.textMuted} />

            <Text style={styles.fieldLabel}>Project type</Text>
            <TextInput style={styles.input} value={projectType} onChangeText={setProjectType} placeholder="Kitchen remodel, bathroom, ADU…" placeholderTextColor={Colors.textMuted} />

            <Text style={styles.fieldLabel}>Scope notes</Text>
            <TextInput style={[styles.input, styles.multilineInput]} value={scope} onChangeText={setScope} placeholder="Anything specific the homeowner mentioned" placeholderTextColor={Colors.textMuted} multiline textAlignVertical="top" />

            <View style={styles.budgetRow}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Text style={styles.fieldLabel}>Budget min</Text>
                <TextInput style={styles.input} value={budgetMin} onChangeText={setBudgetMin} placeholder="0" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Text style={styles.fieldLabel}>Budget max</Text>
                <TextInput style={styles.input} value={budgetMax} onChangeText={setBudgetMax} placeholder="0" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Timeline</Text>
            <TextInput style={styles.input} value={timeline} onChangeText={setTimeline} placeholder="When do they want to start?" placeholderTextColor={Colors.textMuted} />

            <Text style={styles.fieldLabel}>Source</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {LEAD_SOURCES.map(s => (
                <TouchableOpacity key={s} style={[styles.chip, source === s && styles.chipActive]} onPress={() => setSource(s)}>
                  <Text style={[styles.chipText, source === s && styles.chipTextActive]}>{LEAD_SOURCE_LABELS[s]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Activity log */}
          {existing && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Activity</Text>
              <View style={styles.touchKindRow}>
                {(['call','text','email','meeting','site_visit','voicemail','note'] as LeadTouchKind[]).map(k => (
                  <TouchableOpacity key={k} style={[styles.chipSmall, touchKind === k && styles.chipSmallActive]} onPress={() => setTouchKind(k)}>
                    <Text style={[styles.chipSmallText, touchKind === k && styles.chipSmallTextActive]}>{k.replace('_',' ')}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.touchInputRow}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={touchBody}
                  onChangeText={setTouchBody}
                  placeholder={`Log a ${touchKind.replace('_',' ')}…`}
                  placeholderTextColor={Colors.textMuted}
                />
                <TouchableOpacity style={styles.touchVoiceBtn} onPress={() => setVoiceLogOpen(true)} activeOpacity={0.8}>
                  <Mic size={16} color={Colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.touchAddBtn, !touchBody.trim() && styles.touchAddBtnDisabled]}
                  onPress={handleLogTouch}
                  disabled={!touchBody.trim()}
                  activeOpacity={0.8}
                >
                  <Text style={styles.touchAddBtnText}>Log</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.touchList}>
                {(existing.touches ?? []).length === 0 ? (
                  <Text style={styles.emptyText}>No activity yet. Log your first call / text above.</Text>
                ) : (
                  (existing.touches ?? []).map(t => (
                    <View key={t.id} style={styles.touchRow}>
                      <View style={styles.touchKindBadge}>
                        <Text style={styles.touchKindBadgeText}>{t.kind.replace('_',' ')}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.touchBody}>{t.body}</Text>
                        <Text style={styles.touchMeta}>{new Date(t.occurredAt).toLocaleString()}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Sticky bottom save bar */}
        <View style={[styles.saveBar, { paddingBottom: insets.bottom + 12 }]}>
          {existing && (
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
              <Trash2 size={16} color={Colors.error} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            onPress={saveAndExit}
            disabled={!canSave}
            activeOpacity={0.85}
          >
            <Save size={16} color="#FFF" />
            <Text style={styles.saveBtnText}>{isNew ? 'Save lead' : 'Save changes'}</Text>
          </TouchableOpacity>
        </View>

        <VoiceCaptureModal
          visible={voiceLogOpen}
          onClose={() => setVoiceLogOpen(false)}
          onTranscriptReady={handleVoiceLogTouch}
          title={`Log ${touchKind.replace('_',' ')}`}
          contextLine={existing ? `for ${existing.name}` : undefined}
          suggestions={[
            'Called, left a voicemail asking when they want to walk the site',
            'Texted with the budget summary, they said they need a couple days to think',
            'Emailed the proposal, attached the schedule and selections allowance',
            'Met at the house, walked the kitchen, took photos of the existing layout',
          ]}
        />
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  quickRow: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 0, flexWrap: 'wrap' },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  quickBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  scoreCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    margin: 16, marginBottom: 0,
    backgroundColor: Colors.surface,
    padding: 14, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  scoreCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  scoreCircleHot: { backgroundColor: Colors.primary },
  scoreCircleText: { fontSize: 18, fontWeight: '700' as const, color: Colors.primary },
  scoreCircleTextHot: { color: '#FFF' },
  scoreCardTitle: { fontSize: 12, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  scoreCardReason: { fontSize: 13, color: Colors.text, marginTop: 2, lineHeight: 18 },
  section: { padding: 16, paddingBottom: 8 },
  sectionLabel: { fontSize: 12, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  fieldLabel: { fontSize: 13, color: Colors.textMuted, marginTop: 12, marginBottom: 6, fontWeight: '600' as const },
  input: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder,
    fontSize: 15, color: Colors.text,
  },
  multilineInput: { minHeight: 80 },
  budgetRow: { flexDirection: 'row', marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: Colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.text, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  convertBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 12,
    backgroundColor: Colors.success,
    paddingVertical: 14, borderRadius: 12,
  },
  convertBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' as const },
  convertedBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 12,
    backgroundColor: Colors.primary + '15',
    paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  convertedBtnText: { color: Colors.primary, fontSize: 14, fontWeight: '600' as const },
  touchKindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chipSmall: {
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: Colors.surface, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  chipSmallActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  chipSmallText: { fontSize: 12, color: Colors.text, textTransform: 'capitalize' as const },
  chipSmallTextActive: { color: '#FFF' },
  touchInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  touchVoiceBtn: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  touchAddBtn: {
    backgroundColor: Colors.text,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
  },
  touchAddBtnDisabled: { backgroundColor: Colors.fillTertiary },
  touchAddBtnText: { color: '#FFF', fontSize: 13, fontWeight: '600' as const },
  touchList: { marginTop: 12, gap: 10 },
  touchRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: Colors.surface,
    padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  touchKindBadge: {
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  touchKindBadgeText: { fontSize: 10, fontWeight: '700' as const, color: Colors.primary, textTransform: 'uppercase' },
  touchBody: { fontSize: 13, color: Colors.text, lineHeight: 18 },
  touchMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', paddingVertical: 12 },
  saveBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', gap: 8,
    backgroundColor: Colors.background,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder,
    paddingHorizontal: 16, paddingTop: 12,
  },
  deleteBtn: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: Colors.error + '15',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.error + '30',
  },
  saveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14, borderRadius: 12,
  },
  saveBtnDisabled: { backgroundColor: Colors.fillTertiary },
  saveBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' as const },
});
